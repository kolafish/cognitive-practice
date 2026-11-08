#!/usr/bin/env python3
"""Build main practice from reviewed source items and original word analogies.

A committed audit manifest makes ordinary builds Python-stdlib-only. Regenerate
media/BIG audits with --audit using Pillow, numpy and a local ffmpeg executable.
The full original bank is read, never modified. No raster assets are generated.
"""

import argparse
import copy
import hashlib
import itertools
import json
import re
import shutil
import subprocess
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
CACHE = PUBLIC / "data/practice-curation.json"
OUTPUT = PUBLIC / "data/practice-bank.json"
ORIGINAL_ANALOGIES = ROOT / "assets/north-verbal-analogies.json"
ORIGINAL_ANALOGY_SOURCE = {"id": "north-original-analogy", "name": "思维练习室原创词语类比"}
ANALOGY_LEVEL_BASIS = {
    6: "三项按顺序对应两层关系。",
    7: "三项按顺序对应，需从相近选项中区分关系方向或第三项的具体作用。",
    8: "四项按顺序对应，需核对整条关系链，并排除只符合部分关系的选项。",
}

# Each item below was read with its complete choices, source key and explanation.
# Levels describe estimated relational complexity within this small reviewed pool.
ANALOGY = {
    "ekar-1501d0-zh": (1, "职业与其主要服务对象：教师面对学生，医生面对病人。"),
    "ekar-a49011-zh": (1, "身份与主要活动：学生读书，学者做学问。"),
    "ekar-c3f2dd-zh": (1, "被容纳的物品与容器：水装在水杯里，货物装在集装箱里。"),
    "ekar-082fe4-zh": (2, "感官与感受的刺激：眼睛感受光线，耳朵感受声音。"),
    "ekar-5b4b40-zh": (2, "日常工具与配合使用的耗材：钢笔与墨水，牙刷与牙膏。"),
    "ekar-d05dde-zh": (2, "起基础支撑作用的部分与整体：树根支撑树，墙基支撑房屋。"),
    "ekar-14c6ff-zh": (3, "集合与基本组成单位：森林由树木组成，建筑群由建筑物组成。"),
    "ekar-d16982-zh": (3, "集合与基本组成单位：森林由树组成，山脉由山组成。"),
    "ekar-376319-zh": (3, "构成材料与整体：笔画组成汉字，字组成词。"),
    "ekar-6b9ddf-zh": (4, "两个并列种类与共同上位类别：花草属于植物，牛羊属于家畜。"),
    "ekar-a30ebe-zh": (4, "同一大类下的两个并列种类：矿泉水和纯净水，象棋和军棋。"),
    "ekar-4f64d0-zh": (4, "常见动物与身体的覆盖部分：鱼与鳞片，鸟与羽毛。"),
    "ekar-a7475c-zh": (5, "职业、工作手段、工作目的：医生检查以诊断病情，教师讲课以传授知识。"),
    "ekar-d484b5-zh": (5, "情境与两种预防用品：防叮咬用蚊香或花露水，防淋雨用雨伞或雨衣。"),
    "ekar-27a762-zh": (6, "同一事物的两种用途：灯可照明、装饰，水可浇灌、饮用。"),
    "ekar-d3a0f3-zh": (6, "身体部位、佩戴物、佩戴物的一种：眼睛—眼镜—隐形眼镜；手掌—手套—纯棉手套。"),
    "ekar-81098b-zh": (7, "载体、内容、感知器官：报刊承载新闻，用眼睛阅读；唱片承载歌曲，用耳朵听。"),
    "ekar-fd310a-zh": (7, "整体与其两个组成部分：汽车有底盘和发动机，车身有车门和车窗。"),
    "ekar-2cd070-zh": (8, "连续加工链：木材制成纸张，再制成图书；小麦制成面粉，再制成面包。"),
    "ekar-cd2f7a-zh": (8, "物品、能量来源、工作状态：汽车靠汽油奔跑，电灯靠电流发光。"),
}
REVIEWED_REJECTIONS = {
    "ekar-a65be5-zh": "多个选项可解释为物品与用途，需借助题面未明说的更窄标准。",
    "ekar-416216-zh": "职业—场所—活动关系不只一个选项近似成立。",
    "ekar-14f4da-zh": "动作与对象关系太宽，正确项依赖未明说的资源获取限定。",
    "ekar-6ed8e1-zh": "来源解释含不准确的关系陈述，暂不纳入。",
    "ekar-fda3a6-zh": "物品与摆放场所关系的限定不足。",
    "ekar-391a0d-zh": "使用方式的区别依赖较窄解释。",
    "ekar-f20ad6-zh": "需要额外的人体部位词义知识。",
    "ekar-f4d3d1-zh": "依赖材料性质与未明说的条件。",
    "ekar-e8d81a-zh": "需要仿生学常识，偏知识性。",
    "ekar-206cff-zh": "正确项依赖产出、形成、屠宰等未明说的细微区别。",
    "ekar-e6dc26-zh": "种类归属与季节组成的语义区别容易有不同解读，保守排除。",
}
FAMILY_NAMES = {
    "matrix-choice": "图形矩阵选择",
    "folding-static": "静态折纸孔位",
    "folding-animation": "动画折纸孔位",
    "verbal-order": "条件排序推理",
    "verbal-analogy": "常见词关系类比",
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def short_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()[:16]


def holes(q):
    return q["fullAnswerOriginal"]["result_holes"]


def positions(q):
    return tuple(sorted(h["location"] for h in holes(q)))


def cohort(q):
    # Identical counts AND shape/size multiset: counting/shape alone cannot win.
    return (q["answer"], tuple(sorted((h["shape"], h["size"]) for h in holes(q))))


def image_audit(q):
    import numpy as np
    from PIL import Image

    im = Image.open(PUBLIC / q["answerImage"]).convert("RGB")
    a = np.array(im).astype("int16")
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    mask = (r >= 160) & (r <= 245) & (abs(r - g) <= 2) & (abs(r - b) <= 2)
    yy, xx = np.where(mask)
    if not len(xx):
        return {"complete": False, "reason": "无法识别完整纸张边界"}
    x0, y0, x1, y1 = int(xx.min()), int(yy.min()), int(xx.max() + 1), int(yy.max() + 1)
    complete = x1 - x0 >= 455 and y1 - y0 >= 455 and x0 > 0 and y0 > 0 and x1 < im.width and y1 < im.height
    pad = 2
    crop_x0, crop_y0 = max(0, x0 - pad), max(0, y0 - pad)
    crop_x1, crop_y1 = min(im.width, x1 + pad), min(im.height, y1 + pad)
    return {
        "complete": complete,
        "reason": "纸张边界完整" if complete else "答案图纸张触及画布边缘或边长不足，可能截断",
        "imageCrop": {"x": crop_x0, "y": crop_y0, "width": crop_x1 - crop_x0, "height": crop_y1 - crop_y0, "sourceWidth": im.width, "sourceHeight": im.height},
    }


def video_audit(q, ffmpeg):
    import numpy as np

    cmd = [ffmpeg, "-v", "error", "-threads", "1", "-i", str(PUBLIC / q["video"]),
           "-vf", "scale=250:190:flags=area", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode or not result.stdout or len(result.stdout) % (250 * 190 * 3):
        return {"complete": False, "reason": "视频解码失败", "decodeError": result.stderr.decode(errors="replace")[:300]}
    frames = np.frombuffer(result.stdout, dtype=np.uint8).reshape(-1, 190, 250, 3)
    gray_blanks = 0
    touched = []
    max_border = 0
    for i, frame in enumerate(frames):
        # A uniform light-gray introductory frame fills the canvas; it is not paper clipping.
        if frame.std() < 3:
            gray_blanks += 1
            continue
        edge = np.concatenate((frame[:2].reshape(-1, 3), frame[-2:].reshape(-1, 3),
                               frame[:, :2].reshape(-1, 3), frame[:, -2:].reshape(-1, 3)))
        n = int(((edge.min(1) > 110) & ((edge.max(1) - edge.min(1)) < 30)).sum())
        max_border = max(max_border, n)
        if n >= 3:
            touched.append(i)
    reason = "降采样全帧边界未见纸张触边" if not touched else "降采样帧见纸张触及边界，保守排除"
    if q["id"] == "mentalblackboard-PFHP_56":
        # The flagged opening frame was visually inspected: an update dialog
        # overlays an unrelated desktop. Keep this video in expansion only.
        reason = "开场帧人工核验含软件更新弹窗，题面显示不完整，保守排除"
    return {
        "complete": not touched and len(frames) > gray_blanks,
        "reason": reason,
        "frameCount": len(frames), "ignoredUniformFrames": gray_blanks,
        "paperBorderFrames": touched, "maxPaperBorderPixels": max_border,
        "method": "all decoded frames at 250x190; two-pixel border; ignore frame std<3; reject >=3 light achromatic border pixels",
    }


def strip_article(s):
    return re.sub(r"^(?:the|a|an) ", "", s.strip(), flags=re.I)


def parse_statement(s, objects):
    s = s.strip().rstrip(".")
    for obj in sorted(objects, key=len, reverse=True):
        for prefix in (obj, "The " + obj, "the " + obj):
            if s.startswith(prefix + " "):
                rem = s[len(prefix):].strip()
                break
        else:
            continue
        break
    else:
        raise ValueError("Unknown subject: " + s)
    for marker in ("is ", "are ", "finished "):
        if rem.startswith(marker):
            rem = rem[len(marker):]
            break
    left = objects.index(obj)
    relation = {
        "to the left of ": "lt", "to the right of ": "gt",
        "above ": "lt", "below ": "gt", "newer than ": "lt", "older than ": "gt",
        "more expensive than ": "lt", "less expensive than ": "gt",
    }
    for prefix, op in relation.items():
        if rem.startswith(prefix):
            return (op, left, objects.index(strip_article(rem[len(prefix):])))
    rem = re.sub(r"^the ", "", rem)
    n = len(objects)
    names = {"first": 0, "second": 1, "third": 2, "fourth": 3,
             "last": n - 1, "leftmost": 0, "rightmost": n - 1,
             "newest": 0, "oldest": n - 1, "most expensive": 0, "cheapest": n - 1}
    if rem in names:
        return ("pos", left, names[rem])
    ordinal = {"second": 1, "third": 2, "fourth": 3}
    for word, index in ordinal.items():
        if rem in {word + " from the left", word + "-newest", word + "-most expensive"}:
            return ("pos", left, index)
        if rem in {word + " from the right", word + "-oldest", word + "-cheapest", word + "-to-last"}:
            return ("pos", left, n - 1 - index)
    raise ValueError("Unknown predicate: " + s)


def satisfies(pos, c):
    op, a, b = c
    return pos[a] == b if op == "pos" else pos[a] < pos[b] if op == "lt" else pos[a] > pos[b]


def sorting_audit(rows):
    by_stem = defaultdict(list)
    for r in rows.values():
        if r["source_id"] == "bigbench_logical_deduction":
            by_stem[r["stem_id"]].append(r)
    result = {}
    for stem, stem_rows in sorted(by_stem.items()):
        first = stem_rows[0]
        intro, *clues_text = first["prompt_en"].rstrip(".").split(". ")
        objects = [strip_article(s) for s in intro.split(": ")[1].replace(", and ", ", ").replace(" and ", ", ").split(", ")]
        clues = [parse_statement(s, objects) for s in clues_text]
        all_positions = []
        solution_count = 0
        for order in itertools.permutations(range(len(objects))):
            pos = [0] * len(objects)
            for rank, obj in enumerate(order):
                pos[obj] = rank
            failed = sum((1 << i) for i, c in enumerate(clues) if not satisfies(pos, c))
            all_positions.append((pos, failed))
            solution_count += not failed
        if solution_count != 1:
            raise ValueError(f"{stem}: expected unique source solution, got {solution_count}")
        subsets = sorted(range(1, 1 << len(clues)), key=lambda n: (n.bit_count(), n))
        for r in stem_rows:
            correct = next(c for c in r["choices"] if c["id"] == r["answer"])
            target = parse_statement(correct["text_en"], objects)
            if not all(satisfies(p, target) for p, failed in all_positions if not failed):
                raise ValueError(r["id"] + ": source key contradicts solution")
            solution = next(p for p, failed in all_positions if not failed)
            true_choices = [c["id"] for c in r["choices"] if satisfies(solution, parse_statement(c["text_en"], objects))]
            if true_choices != [r["answer"]]:
                raise ValueError(r["id"] + ": choice set is not uniquely correct")
            wrong_masks = {failed for p, failed in all_positions if not satisfies(p, target)}
            minimum = next(s.bit_count() for s in subsets if all(s & failed for failed in wrong_masks))
            direct = correct["text_en"].rstrip(".").casefold() in {s.rstrip(".").casefold() for s in clues_text}
            result[r["id"]] = {
                "objectCount": len(objects), "clueCount": len(clues),
                "relativeClueCount": sum(c[0] != "pos" for c in clues),
                "minimumRequiredClues": minimum, "directRestatement": direct,
                "solutionCount": solution_count, "sourceAnswerVerified": True,
                "promptOriginalEn": r["prompt_en"],
            }
    return result


def audit(bank, bank_sha, research, ffmpeg):
    rows = {r["id"]: r for r in (json.loads(s) for s in (research / "assets/normalized/items.jsonl").read_text().splitlines())}
    videos = [q for q in bank["categories"]["spatial"] if q["type"] == "folding-video"]
    with ThreadPoolExecutor(max_workers=6) as pool:
        images = dict(zip((q["id"] for q in videos), pool.map(image_audit, videos)))
    full_cohorts = defaultdict(set)
    for q in videos:
        if images[q["id"]]["complete"]:
            full_cohorts[cohort(q)].add(positions(q))
    candidates = [q for q in videos if images[q["id"]]["complete"] and len(full_cohorts[cohort(q)]) >= 4]
    with ThreadPoolExecutor(max_workers=6) as pool:
        video_checks = dict(zip((q["id"] for q in candidates), pool.map(lambda q: video_audit(q, ffmpeg), candidates)))
    return {
        "version": 1, "sourceBankSha256": bank_sha,
        "auditScope": "existing local assets only; no downloads; no raster asset mutation",
        "answerImageAudit": images, "videoAudit": video_checks,
        "sortingAudit": sorting_audit(rows),
        "videoSourceConfigs": {q["id"]: {k: rows[q["id"]][k] for k in ("operations", "initial_holes") if k in rows[q["id"]]} for q in videos},
        "analogyWhitelist": {k: {"familyLevel": v[0], "reason": v[1]} for k, v in ANALOGY.items()},
        "reviewedAnalogyRejections": REVIEWED_REJECTIONS,
    }


def add_meta(q, family, level, reason, basis):
    item = copy.deepcopy(q)
    item.update(taskFamily=family, taskFamilyName=FAMILY_NAMES[family],
                familyLevel=level, familyLevelBasis=basis,
                sourceQuestionId=q["id"], curationReason=reason)
    return item


def original_analogies():
    rows = json.loads(ORIGINAL_ANALOGIES.read_text())
    assert len({row["key"] for row in rows}) == len(rows), "Duplicate original analogy ID"
    assert len({row["stem"] for row in rows}) == len(rows), "Duplicate original analogy stem"
    for row in rows:
        key, level = row["key"], row["level"]
        assert re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", key), key
        basis = ANALOGY_LEVEL_BASIS[level]
        terms = 4 if level == 8 else 3
        options = row["distractors"][:]
        assert len(options) == 3 and len({row["stem"], row["correct"], *options}) == 5, key
        assert all(len(option.split("／")) == terms and all(part.strip() for part in option.split("／"))
                   for option in [row["stem"], row["correct"], *options]), key
        assert row["explanation"].strip(), key
        correct_index = int(short_hash(key), 16) % 4
        options.insert(correct_index, row["correct"])
        item = {
            "id": "north-analogy-" + key,
            "sourceId": ORIGINAL_ANALOGY_SOURCE["id"],
            "originalFamily": "chinese_analogy",
            "originalDifficulty": {"status": "unrated", "label_zh": "原创题，无外部难度标定", "value": None},
            "category": "verbal", "type": "choice", "level": level,
            "prompt": f"{row['stem']}。选择词语关系和顺序最相近的一项。",
            "choices": [{"id": letter, "text": text} for letter, text in zip("ABCD", options)],
            "answer": "ABCD"[correct_index], "explanation": row["explanation"],
        }
        yield add_meta(item, "verbal-analogy", level,
                       "原创。逐题核对完整关系、关系顺序与干扰项。",
                       f"本题族练习估算。{basis}未按作答数据校准。")


def build(bank, audits):
    categories = {"figure": [], "memory": [], "spatial": [], "verbal": []}
    exclusions = []
    by_id = {q["id"]: q for qs in bank["categories"].values() for q in qs}
    assert set(ANALOGY) <= by_id.keys(), "A reviewed analogy source item is missing"
    included_original_ids = set()
    for q in bank["categories"]["figure"]:
        if q["originalFamily"] == "matrix_reasoning":
            categories["figure"].append(add_meta(q, "matrix-choice", q["originalDifficulty"]["value"],
                "保留现有80道图形矩阵选择题；排除需要拼装答案的构造矩阵。",
                "本题族内练习估算：使用原作者1–8维度得分，非年龄常模或测量结果。"))
            included_original_ids.add(q["id"])
    for q in bank["categories"]["spatial"]:
        if q["originalFamily"] == "paper_folding":
            level = {0: 1, 1: 4, 2: 7}[q["originalDifficulty"]["value"]]
            item = add_meta(q, "folding-static", level,
                "保留原有四选一展开孔位题；图内A–D必须保持原序。",
                "本题族只支持[1,4,7]档：原Level0/1/2分别映射；无证据拆分同级题。")
            item["old"] = {"id": q["id"], "type": q["type"], "level": q["level"]}
            categories["spatial"].append(item)
            included_original_ids.add(q["id"])
    for q in bank["categories"]["verbal"]:
        if q["originalFamily"] == "verbal_deduction":
            a = audits["sortingAudit"][q["id"]]
            if a["directRestatement"] or a["minimumRequiredClues"] < 2:
                exclusions.append({"id": q["id"], "reasonCode": "sorting-direct-or-one-clue", "reason": "正确选项直接重述原条件，或单个条件已足够推出，不进入推理主练。"})
                continue
            level = min(8, {3: 1, 5: 3, 7: 5}[a["objectCount"]] + max(0, a["minimumRequiredClues"] - 2) + int(a["relativeClueCount"] == a["clueCount"]))
            item = add_meta(q, "verbal-order", level,
                f"穷举排列验证原答案唯一且正确；至少需要{a['minimumRequiredClues']}个条件才能推出正确选项，非直接重述。",
                "本题族估算：3/5/7对象基础档1/3/5；最少必要条件每多于2个加1；纯相对关系加1；上限8。")
            item["curationMetrics"] = {k: v for k, v in a.items() if k != "promptOriginalEn"}
            item["originalPromptEn"] = a["promptOriginalEn"]
            categories["verbal"].append(item)
            included_original_ids.add(q["id"])
        elif q["id"] in ANALOGY:
            level, reason = ANALOGY[q["id"]]
            item = add_meta(q, "verbal-analogy", level,
                "逐题阅读题干、全部选项、原答案和解释后列入白名单；" + reason,
                "20道已审词语关系内的1–8档估算：从二元日常关系，到三元关系、关系链和排除近似项；无校准或年龄含义。")
            item["curatedExplanation"] = reason
            item["reviewStatus"] = "manual-whitelist"
            if q["id"] in {"ekar-14c6ff-zh", "ekar-d16982-zh"}:
                item["groupId"] = "north-analogy-forest-parts"
            categories["verbal"].append(item)
            included_original_ids.add(q["id"])
        else:
            reviewed = q["id"] in REVIEWED_REJECTIONS
            exclusions.append({"id": q["id"], "reasonCode": "analogy-reviewed-excluded" if reviewed else "analogy-not-whitelisted",
                               "reason": REVIEWED_REJECTIONS.get(q["id"], "未进入逐题人工审阅白名单；不能据启发式筛词自动认定关系清晰。")})
    video_questions = [q for q in bank["categories"]["spatial"] if q["type"] == "folding-video"]
    image_checks = audits["answerImageAudit"]
    cohorts = defaultdict(dict)
    for q in video_questions:
        if image_checks[q["id"]]["complete"]:
            cohorts[cohort(q)].setdefault(positions(q), q)
    for q in video_questions:
        a = image_checks[q["id"]]
        if not a["complete"]:
            exclusions.append({"id": q["id"], "reasonCode": "fold-answer-clipped", "reason": a["reason"]})
            continue
        candidates = cohorts[cohort(q)]
        if len(candidates) < 4:
            exclusions.append({"id": q["id"], "reasonCode": "fold-insufficient-matched-distractors", "reason": "同孔数、同孔形/大小且答案完整的不同孔位不足4种。"})
            continue
        if not audits["videoAudit"][q["id"]]["complete"]:
            exclusions.append({"id": q["id"], "reasonCode": "fold-video-incomplete", "reason": audits["videoAudit"][q["id"]]["reason"]})
            continue
        m = q["originalDifficulty"]["metrics"]
        level = max(1, min(8, 2 * m["fold_count"] - 1 + m["rotation_count"] + m["initial_hole_count"] - 1))
        item = add_meta(q, "folding-animation", level,
            "正确图与至少3幅同孔数、同孔形/大小的不同孔位图匹配；答案图完整，视频降采样全帧边界检查通过。",
            "动画题族独立估算：2×折叠数−1＋旋转数＋初始孔数−1，限制1–8；静态折纸档位不混用。")
        item["id"] = "north-fold-" + q["id"]
        item["type"] = "folding-choice"
        item["prompt"] = "观看折叠、旋转和打孔动画。把纸完全展开后，孔的位置与哪幅图一致？四个选项孔数相同，请比较完整孔位；方向以动画中纸张坐标为准。"
        target_positions = positions(q)
        distractors = sorted((other for pos, other in candidates.items() if pos != target_positions),
                              key=lambda other: (len(set(positions(other)) ^ set(target_positions)), short_hash([q["id"], other["id"]])))[:3]
        options = distractors[:]
        correct_index = int(short_hash(q["id"]), 16) % 4
        options.insert(correct_index, q)
        item["choices"] = [
            {"id": chr(65 + i), "image": other["answerImage"],
             "imageCrop": image_checks[other["id"]]["imageCrop"],
             "sourceQuestionId": other["id"], "holeCount": other["answer"],
             "holePositions": list(positions(other)),
             "holeShapeSizes": [list(v) for v in cohort(other)[1]]}
            for i, other in enumerate(options)
        ]
        item["choicesEmbedded"] = False
        item["answer"] = chr(65 + correct_index)
        item["answerImageCrop"] = a["imageCrop"]
        item["groupId"] = "north-fold-position-" + short_hash(target_positions)
        item["old"] = {"id": q["id"], "type": q["type"], "level": q["level"], "answer": q["answer"], "prompt": q["prompt"]}
        item["sourceConfig"] = audits["videoSourceConfigs"][q["id"]]
        item["adaptation"] = {
            "kind": "unfolded-hole-position-image-choice", "newQuestionId": True,
            "originalQuestionType": q["type"], "originalCountOnlyAnswer": q["answer"],
            "correctImageSource": q["id"], "distractors": "existing complete answer images; same hole count and shape/size multiset; distinct position multisets",
            "cropping": "viewBox around existing complete paper bounds; source PNGs unchanged",
            "validation": "all decoded video frames screened at 250x190, not a full-resolution geometry proof",
        }
        item["explanation"] = "正确选项的完整孔位见答案图。四个选项孔数和孔形/大小分布相同，须根据每次折叠与旋转推断孔的位置。"
        categories["spatial"].append(item)
        included_original_ids.add(q["id"])
    accounted = included_original_ids | {e["id"] for e in exclusions}
    for qid, q in by_id.items():
        if qid not in accounted:
            exclusions.append({"id": qid, "reasonCode": "other-family-expansion-only", "reason": "本轮主练范围之外；原题与素材保留在拓展题库。"})
    excluded_ids = {e["id"] for e in exclusions}
    assert not included_original_ids & excluded_ids
    assert len(excluded_ids) == len(exclusions)
    assert included_original_ids | excluded_ids == by_id.keys()
    authored = list(original_analogies())
    categories["verbal"].extend(authored)
    family_stats = {}
    for family, name in FAMILY_NAMES.items():
        qs = [q for items in categories.values() for q in items if q["taskFamily"] == family]
        levels = Counter(q["familyLevel"] for q in qs)
        family_stats[family] = {"name": name, "count": len(qs), "levels": sorted(levels), "byLevel": {str(k): levels[k] for k in sorted(levels)}}
    return {
        "version": 1, "categories": categories, "sources": [*bank["sources"], ORIGINAL_ANALOGY_SOURCE],
        "stats": {"total": sum(map(len, categories.values())), "byCategory": {k: len(v) for k, v in categories.items()}, "byTaskFamily": family_stats},
        "curation": {
            "scope": "北中主练。筛选公开题，并补充原创词语类比。题目用于练习，无年龄常模。",
            "sourceBankSha256": audits["sourceBankSha256"],
            "difficulty": "familyLevel只在同taskFamily内用于练习自适应；支持档位见stats.byTaskFamily.*.levels；不跨来源比较。",
            "memory": "此静态主池留空，由网站独立的可复现原创视觉记忆生成器提供。",
            "auditManifest": "data/practice-curation.json", "excluded": exclusions,
            "exclusionCounts": dict(sorted(Counter(e["reasonCode"] for e in exclusions).items())),
            "analogyManualReview": {"selected": len(ANALOGY), "original": len(authored), "reviewedExcluded": len(REVIEWED_REJECTIONS), "unlisted": "未入白名单不等于逐题判错；保留拓展待审。"},
            "foldingVideoAuditBoundary": f"仅候选{len(audits['videoAudit'])}段视频逐解码帧降采样边界扫描；忽略均匀开场帧，非全分辨率逐帧人工核验。答案图使用保守灰色纸张边界检测。",
        },
    }


def verify(result):
    all_q = [q for qs in result["categories"].values() for q in qs]
    assert len({q["id"] for q in all_q}) == len(all_q)
    media = set()
    for q in all_q:
        assert q["sourceId"] and q["sourceQuestionId"] and q["curationReason"] and 1 <= q["familyLevel"] <= 8
        assert q["answer"] in {c["id"] for c in q["choices"]}
        for field in ("image", "video", "answerImage"):
            if q.get(field): media.add(q[field])
        for c in q["choices"]:
            if c.get("image"): media.add(c["image"])
        if q["type"] == "folding-choice":
            assert len(q["choices"]) == 4
            assert len({tuple(c["holePositions"]) for c in q["choices"]}) == 4
            assert {c["holeCount"] for c in q["choices"]} == {q["fullAnswerOriginal"]["total_holes"]}
            assert len({json.dumps(c["holeShapeSizes"]) for c in q["choices"]}) == 1
            assert all(len(set(c["holePositions"])) == c["holeCount"] for c in q["choices"])
            correct = next(c for c in q["choices"] if c["id"] == q["answer"])
            assert correct["image"] == q["answerImage"] and correct["sourceQuestionId"] == q["sourceQuestionId"]
            assert correct["imageCrop"] == q["answerImageCrop"]
            for c in q["choices"]:
                crop = c["imageCrop"]
                assert crop["x"] >= 0 and crop["y"] >= 0
                assert crop["x"] + crop["width"] <= crop["sourceWidth"]
                assert crop["y"] + crop["height"] <= crop["sourceHeight"]
    for path in media:
        assert path.startswith("assets/bank/") and ".." not in path
        p = PUBLIC / path
        assert p.is_file(), path
        assert digest(p).startswith(p.stem), "Asset changed since original hashed export: " + path
    return {"referencedFiles": len(media), "referencedBytes": sum((PUBLIC / p).stat().st_size for p in media)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit", action="store_true", help="Rebuild local media/reasoning audit; requires Pillow, numpy, ffmpeg and sibling research data")
    parser.add_argument("--research", type=Path, default=ROOT.parent / "beijing-academy-carnival-research")
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg")
    args = parser.parse_args()
    source = PUBLIC / "data/bank.json"
    bank_sha = digest(source)
    bank = json.loads(source.read_text())
    if args.audit:
        audits = audit(bank, bank_sha, args.research, args.ffmpeg)
    else:
        audits = json.loads(CACHE.read_text())
        if audits["sourceBankSha256"] != bank_sha:
            raise SystemExit("Original bank changed; run --audit to regenerate reviewed audit metadata.")
    result = build(bank, audits)
    result["stats"]["media"] = verify(result)
    audits["mainPoolSummary"] = result["stats"]
    audits["exclusionCounts"] = result["curation"]["exclusionCounts"]
    CACHE.write_text(json.dumps(audits, ensure_ascii=False, indent=2) + "\n")
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(json.dumps(result["stats"], ensure_ascii=False, indent=2))
    print("Exclusions:", json.dumps(result["curation"]["exclusionCounts"], ensure_ascii=False))
    print("Output bytes:", OUTPUT.stat().st_size, "Audit bytes:", CACHE.stat().st_size)


if __name__ == "__main__":
    main()
