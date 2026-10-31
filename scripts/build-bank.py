#!/usr/bin/env python3
"""Export the collected bank for a static, noncommercial practice site.

Practice levels are transparent heuristics, separate from source difficulty.
No source executable is run. Only referenced assets with declared reuse terms
are copied; ACCES pictures stay in the private research collection.
"""

import argparse
import hashlib
import html
import json
import math
import re
import shutil
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def clamp(n):
    return max(1, min(8, int(n)))


class LicenseText(HTMLParser):
    """Read license words without copying a source site's scripts or navigation."""

    def __init__(self):
        super().__init__()
        self.hidden = 0
        self.words = []

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden and data.strip():
            self.words.append(data.strip())


def translated_choice(text):
    words = {
        "counterclockwise": "逆时针", "clockwise": "顺时针",
        "Forward": "向前", "Backward": "向后", "Left": "向左", "Right": "向右",
        "Up": "向上", "Down": "向下", "units": "格", "unit": "格",
        "Red": "红色", "Green": "绿色", "Blue": "蓝色", "Yellow": "黄色",
        "Orange": "橙色", "Purple": "紫色", "White": "白色", "Black": "黑色",
    }
    return re.sub(r"\b(" + "|".join(words) + r")\b", lambda m: words[m[0]], text)


def spatial_prompt(row):
    task, original = row["task_type"], row["prompt_en"]
    cannot = "cannot" in original.lower()
    if task == "2DRotation":
        return "观察左侧网格及标记的红色角。只允许旋转，不允许翻转或改变图案，选择能由左图旋转得到的网格。", False
    if task == "3DRotation":
        return ("观察左侧由相同小立方体组成的立体。选择右侧" + ("不能" if cannot else "只通过旋转就能") + "由原立体旋转得到的一项。"), False
    if task == "CubeUnfolding":
        return "观察左侧立方体的颜色或图案。各选项为向上折成立方体的展开图，选择" + ("不能" if cannot else "能") + "折成左侧立方体的一项。", False
    if task == "CubeReconstruction":
        if "opposite" in original:
            color = re.search(r"opposite to the (\w+) face", original)
            palette = {"red": "红", "green": "绿", "blue": "蓝", "yellow": "黄", "orange": "橙", "purple": "紫", "white": "白", "black": "黑", "cyan": "青", "pink": "粉"}
            if color:
                return f"将图中的展开图向上折成立方体，选择与{palette.get(color[1], color[1])}色面相对的面。", False
        if "adjacent colors" in original:
            return "将左侧六个不同颜色的面向上折成立方体，从三维角度观察，选择可能同时看见的相邻颜色组合。", False
        if "adjacent patterns" in original:
            return "将左侧六个不同图案的面向上折成立方体，从三维角度观察，选择可能同时看见的相邻图案组合。", False
        return "将展开图向上折成立方体，按图中要求选择对应的立体或颜色关系。下方英文保留原题的具体条件。", True
    if task == "CubeAssembly":
        return "左上方是完整立体。将右侧给出的一个或两个小立体与某个选项组合，选择能恰好补成完整立体的一项。", False
    if task == "CubeCounting":
        bound = "最少" if "minimum" in original else "最多" if "maximum" in original else "所需"
        return f"根据图中给出的视图和约束，选择需要的{bound}小立方体数量。下方保留原题对视图的具体说明。", True
    if task == "3ViewProjection":
        return "根据图中给出的立体视图，选择原题所要求的正视图、左视图或俯视图。请同时阅读下方原题，确认本题的视图方向。", True
    if task == "BlockMoving":
        return "上排为初始立方体堆的不同视图，下排为目标视图。每次可沿前后左右上下移动一格；目标位置有方块时两者交换。方块不能悬空，移走支撑后上方方块会下落。按图中 xyz 坐标选择能完成变换的操作序列。", False
    if task == "ArrowMoving" and "red arrow" in original:
        return "红箭头为起点，绿箭头为终点。箭头可前、后、左、右移动，其中“前”始终指当前箭头所指方向。每次移动后箭头朝向变成移动方向。选择能从起点到达终点的路线。", False
    if task == "ArrowMoving":
        return "箭头每次移动后会朝向移动方向；前后左右以当前朝向为准。目标位置为空时直接移动，有箭头时交换，两个箭头的移动都须符合规则。请按下方原题给出的具体操作序列，选择可达到的状态。", True
    if task == "CrossSection":
        return "上排给出组合立体的两个观察角度。选择不能由该组合立体截得的截面；组合中各部分的形状见下方原题。", True
    if task == "MechanicalSystem":
        return "根据图中齿轮或机械结构的连接关系，以及下方原题给出的固定、转动方向和相对运动条件，选择正确选项。", True
    raise ValueError(task)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=ROOT.parent / "beijing-academy-carnival-research")
    args = parser.parse_args()
    source_root = args.source.resolve()
    source_rows = [json.loads(line) for line in (source_root / "assets/normalized/items.jsonl").read_text().splitlines()]
    sources = json.loads((source_root / "docs/sources.json").read_text())
    output = ROOT / "public"
    for directory in ["data", "assets/bank", "licenses"]:
        (output / directory).mkdir(parents=True, exist_ok=True)
    copied = {}

    def asset(relative):
        path = (source_root / relative).resolve()
        if not path.is_relative_to(source_root) or not path.is_file():
            raise ValueError(f"Invalid asset: {relative}")
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        suffix = path.suffix.lower()
        if suffix not in {".png", ".jpg", ".jpeg", ".svg", ".mp4"}:
            raise ValueError(f"Unexpected media type: {suffix}")
        name = f"assets/bank/{digest[:24]}{suffix}"
        if name not in copied:
            destination = output / name
            if not destination.exists() or hashlib.sha256(destination.read_bytes()).hexdigest() != digest:
                shutil.copyfile(path, destination)
            copied[name] = {"sha256": digest, "bytes": len(data)}
        return name

    omib = [row for row in source_rows if row["family"] == "matrix_construction"]
    omib_sorted = sorted(omib, key=lambda r: float(r["difficulty"]["metrics"]["irt_difficulty_b"])
                         if r["difficulty"]["metrics"]["irt_difficulty_b"] is not None
                         else math.log((1 - min(.999, r["difficulty"]["metrics"]["observed_accuracy"])) /
                                       max(.001, r["difficulty"]["metrics"]["observed_accuracy"])))
    omib_levels = {row["id"]: clamp(index * 8 // len(omib_sorted) + 1) for index, row in enumerate(omib_sorted)}
    categories = {name: [] for name in ["figure", "memory", "spatial", "verbal"]}
    excluded = []
    for row in source_rows:
        family = row["family"]
        base = {"id": row["id"], "sourceId": row["source_id"], "originalDifficulty": row["difficulty"],
                "originalFamily": family}
        if family == "symmetry_judgement":
            excluded.append({"id": row["id"], "sourceId": row["source_id"], "reason": "作者下载包未提供明确再分发许可，保留在个人研究资料中。"})
            continue
        if family == "matrix_reasoning":
            q = {**base, "category": "figure", "type": "choice", "level": clamp(row["difficulty"]["value"]),
                 "levelBasis": "练习估算：直接使用作者的1–8维度得分，非年龄常模。", "prompt": row["prompt_zh"],
                 "image": asset(row["image"]), "choices": [{"id": c["id"], "image": asset(c["image"])} for c in row["choice_variants"]["md"]],
                 "answer": row["answer"], "explanation": "观察颜色、形状、大小和位置在行列中的变化规律。正确图形见标记选项。"}
        elif family == "matrix_construction":
            q = {**base, "category": "figure", "type": "construction", "level": omib_levels[row["id"]],
                 "levelBasis": "练习估算：在OMIB内部按原研究IRT难度分成8个等频档；缺失b时用原样本正确率近似排序。非跨来源常模。",
                 "prompt": row["prompt_zh"], "image": asset(row["image"]),
                 "elements": [{"id": str(index), "image": asset(image)} for index, image in enumerate(row["construction_elements"])],
                 "answer": [str(index) for index in row["answer_element_ids_zero_based"]],
                 "explanation": "选择的元素必须恰好组成缺失图形；多选或漏选都计为错误。"}
        elif family == "memory":
            grid = row["task_type"] == "spatial_sequence"
            length = row["sequence_length"]
            level = {2: 1, 3: 2, 4: 3, 5: 5, 6: 6, 7: 8}.get(length, 8) if grid else {3: 4, 4: 6, 5: 8}[length]
            q = {**base, "category": "memory", "type": "memory-grid" if grid else "memory-digits", "level": level,
                 "levelBasis": "练习估算：以记忆项数分档；两位数序列另加复杂度。显示时间由练习界面确定，非源任务常模。",
                 "prompt": "记住方格依次亮起的位置，再按相同顺序点击。" if grid else "记住依次出现的两位数，再按相同顺序输入。",
                 "sequence": row["sequence"], "answer": row["answer"], "gridRows": row["grid_rows"], "gridColumns": row["grid_columns"],
                 "displayMs": 850, "intervalMs": 250,
                 "layoutNote": "本练习将序列位置映射到4×4方格，按行从1计数；布局与850/250毫秒节奏为练习改编，不复现原任务常模。" if grid and row["grid_rows"] == 4 else row.get("grid_layout_status"),
                 "explanation": "正确顺序：" + " → ".join(map(str, row["answer"]))}
        elif family == "visual_memory_binding":
            delay = row["protocol"]["source_retention_delay_ms"]
            q = {**base, "category": "memory", "type": "memory-binding", "level": 3 if delay < 2000 else 6,
                 "levelBasis": "练习估算：短保持间隔3档，长保持间隔6档；非逐题实测难度。",
                 "prompt": row["prompt_zh"], "image": asset(row["stimulus_image"]), "probeImage": asset(row["probe_image"]),
                 "displayMs": row["protocol"]["source_target_duration_ms"], "delayMs": delay, "answer": row["answer"],
                 "choices": [{"id": "match", "text": "相符"}, {"id": "mismatch", "text": "不相符"}],
                 "explanation": "本题探测图与记忆图" + ("相符。" if row["answer"] == "match" else "不相符。")}
        elif family == "paper_folding":
            level = int(row["level_original"].removeprefix("Level"))
            q = {**base, "category": "spatial", "type": "choice", "level": [1, 4, 7][level],
                 "levelBasis": "练习估算：原Level0/1/2分别映射为1/4/7档，非年龄常模。",
                 "prompt": row["prompt_zh"], "image": asset(row["image"]), "choicesEmbedded": True,
                 "choices": [{"id": x, "text": x} for x in row["choices"]], "answer": row["answer"],
                 "explanation": "原题参考解释（英文）：" + row["explanation_en"]}
        elif family == "spatial_supplement":
            task = row["task_type"]
            level = int(re.search(r"Level(\d+)", row["difficulty"]["metrics"].get("source_category", str(row["difficulty"]["value"])))[1])
            mapped = {"2DRotation": [1, 4], "3DRotation": [3, 6], "CubeReconstruction": [2, 4, 7],
                      "CubeUnfolding": [3, 5, 7], "ArrowMoving": [3, 6], "BlockMoving": [3, 6],
                      "MechanicalSystem": [5, 8], "3ViewProjection": [3, 5], "CrossSection": [3, 5, 7],
                      "CubeCounting": [2, 4, 6], "CubeAssembly": [3, 6]}[task][level]
            prompt, needs_original = spatial_prompt(row)
            q = {**base, "category": "spatial", "type": "choice", "level": mapped,
                 "levelBasis": "练习估算：按来源子任务和原等级映射；三视图按材料类别启发式分档，非实测题目难度。",
                 "prompt": prompt, "originalPromptEn": row["prompt_en"], "promptNeedsOriginal": needs_original,
                 "taskName": task, "image": asset(row["image"]), "choicesEmbedded": True,
                 "choices": [{"id": c["id"], "text": translated_choice(c.get("text_en", c["id"]))} for c in row["choices"]],
                 "answer": row["answer"], "explanation": "原题参考解释（英文）：" + row["explanation_en"]}
        elif family == "paper_folding_animation":
            m = row["difficulty"]["metrics"]
            level = clamp(round(m["fold_count"] * 1.4 + m["rotation_count"] * .6 + math.log2(m["initial_hole_count"] + 1)))
            q = {**base, "category": "spatial", "type": "folding-video", "level": level,
                 "levelBasis": "练习估算：依据折叠次数、旋转次数与初始孔数分档。",
                 "prompt": "观看折叠、旋转及打孔动画，想象完全展开后，一共有多少个孔？本练习只判断孔的总数。",
                 "video": asset(row["stimulus_video"]), "answerImage": asset(row["answer_image"]),
                 "answer": row["answer"]["total_holes"], "fullAnswerOriginal": row["answer"],
                 "explanation": f"展开后共有{row['answer']['total_holes']}个孔。原数据还包含孔位、形状和方向；本练习仅计孔数。"}
        elif family == "verbal_deduction":
            n = row["object_count"]
            correct_en = next(x["text_en"] for x in row["choices"] if x["id"] == row["answer"])
            direct = correct_en.lower().rstrip(".") in row["prompt_en"].lower()
            level = {3: (1 if direct else 2), 5: (3 if direct else 5), 7: (5 if direct else 8)}[n]
            q = {**base, "category": "verbal", "type": "choice", "level": level,
                 "levelBasis": "练习估算：3/5/7对象分档；答案直接出现在条件中时降低档位。",
                 "groupId": row["stem_id"], "prompt": row["prompt_zh"],
                 "choices": [{"id": c["id"], "text": c["text_zh"]} for c in row["choices"]],
                 "answer": row["answer"], "explanation": "完整排列顺序：" + " → ".join(row["solution_order_zh"])}
        elif family == "chinese_analogy":
            m = row["difficulty"]["metrics"]
            relation_count = len(m.get("relation_codes", []))
            level = clamp(3 + max(0, m["query_term_count"] - 2) * 2 + min(2, max(0, relation_count - 1)) + (len(row["source_question"]) >= 15))
            q = {**base, "category": "verbal", "type": "choice", "level": level,
                 "levelBasis": "练习估算：词语个数、关系标注数量和题干长度启发式分档；源题没有逐题人类难度，仍保留待评定状态。",
                 "prompt": row["prompt_zh"], "choices": [{"id": c["id"], "text": c["text_zh"]} for c in row["choices"]],
                 "answer": row["answer"], "explanation": "\n".join(row.get("explanations_zh") or []),
                 "explanationsOriginal": row.get("explanations_zh")}
        else:
            raise ValueError(f"Unsupported family {family}")
        categories[q["category"]].append(q)

    used_sources = {q["sourceId"] for qs in categories.values() for q in qs}
    source_info = []
    for source in sources:
        if source["id"] not in used_sources:
            continue
        info = {key: source[key] for key in ["id", "name", "url", "license"]}
        info["authors"] = source.get("authors", "")
        if source.get("license_file"):
            source_path = source_root / source["license_file"]
            if not source_path.exists() and source["license"] == "GPL-3.0":
                # OMIB's author materials declare GPLv3, but the downloaded
                # directory lacks a standalone license. Supply the unchanged
                # standard GPLv3 text, and keep the OMIB authors above.
                source_path = source_root / "assets/raw/openwmb/LICENSE"
                info["licenseTextNote"] = "Standard GPLv3 text supplied; original author credit retained separately."
            suffix = source_path.suffix
            license_name = f"licenses/{source['id']}{suffix}"
            if source["id"] == "ekar_chinese" and suffix == ".html":
                parsed = LicenseText()
                parsed.feed(source_path.read_text())
                text = "\n".join(parsed.words)
                start = text.index("This Academic Free License")
                end = text.index("\nGet involved", start)
                license_name = "licenses/ekar_chinese.txt"
                (output / license_name).write_text("Academic Free License v. 3.0\n\n" + text[start:end] + "\n\nSource: https://opensource.org/license/afl-3-0\n")
                stale_html = output / "licenses/ekar_chinese.html"
                if stale_html.exists():
                    stale_html.unlink()
            else:
                shutil.copyfile(source_path, output / license_name)
            info["licenseFile"] = license_name
        source_info.append(info)
    stats = {"total": sum(map(len, categories.values())), "byCategory": {k: len(v) for k, v in categories.items()},
             "byType": dict(Counter(q["type"] for qs in categories.values() for q in qs)),
             "byLevel": {k: dict(sorted(Counter(q["level"] for q in qs).items())) for k, qs in categories.items()},
             "excludedCount": len(excluded), "mediaCount": len(copied), "mediaBytes": sum(x["bytes"] for x in copied.values()),
             "sourceRows": len(source_rows), "practiceLevelsAreEstimates": True,
             "englishOriginalRequired": sum(bool(q.get("promptNeedsOriginal")) for qs in categories.values() for q in qs)}
    bank = {"version": 1, "categories": categories, "sources": source_info, "excluded": excluded, "stats": stats,
            "notes": ["1–8档是练习调节用的估算，不是统一测量量表或年龄常模。", "所有答案在静态文件中，本网站用于个人和非商业练习，不用于防作弊考试。",
                      "部分空间题保留英文原条件，标记promptNeedsOriginal时必须同时展示英文。", "900道动画题改编为只判断展开后孔的总数，原完整答案保留。"]}
    (output / "data/bank.json").write_text(json.dumps(bank, ensure_ascii=False, separators=(",", ":")) + "\n")
    (output / "data/bank-manifest.json").write_text(json.dumps({"stats": stats, "assets": copied}, ensure_ascii=False, indent=2) + "\n")
    validate(bank, output)
    write_attributions(source_info, output)
    docs = ROOT / "docs"
    docs.mkdir(exist_ok=True)
    (docs / "bank-export.md").write_text(
        "# Online bank export\n\nThe online bank contains " + str(stats["total"]) + " records.\n\n"
        + "```json\n" + json.dumps(stats, ensure_ascii=False, indent=2) + "\n```\n\n"
        + "Practice levels are source-specific heuristics normalized to 1–8 solely for step-up/step-down practice. Original difficulty and the per-question basis are retained. They are not an IRT-calibrated composite score.\n\n"
        + "ACCES's 51 images are excluded pending explicit redistribution permission. No age filtering is applied. MaRs uses the md option variant once per base item. BIG-bench keeps stem groups so the selector can avoid reusing the same scenario.\n\n"
        + "Folding videos ask only for the total hole count, a derived question from the original structured-answer task; full original answers and answer images are retained.\n\n"
        + "Tatool sequences containing positions up to 16 use an adapted 4×4 grid with row-major 1-based positions. The bank retains its earlier 850 ms display / 250 ms interval settings, not a reconstruction of source norms. New version 2 practice sessions override memory display durations to 1000 ms per item (or per binding target image), retain the question's inter-item and retention intervals, and save the actual display setting with the session. Version 1 records and unfinished sessions retain their earlier timing.\n\n"
        + "Some spatial items need the original English text to preserve specific motion, view, or composition conditions. Show originalPromptEn visibly when promptNeedsOriginal=true. Embedded A–D labels must retain their source IDs and order.\n\n"
        + "Rebuild with `python3 scripts/build-bank.py --source /path/to/beijing-academy-carnival-research`. All copied media are content-addressed and validated locally; exported data contain no local filesystem paths.\n")
    print(json.dumps(stats, ensure_ascii=False, indent=2))


def validate(bank, output):
    rows = [q for qs in bank["categories"].values() for q in qs]
    assert len(rows) == len({q["id"] for q in rows}) == 5598
    assert len(bank["excluded"]) == 51
    for q in rows:
        assert 1 <= q["level"] <= 8 and q["sourceId"] and q["levelBasis"]
        assert q["originalDifficulty"]
        for key in ["image", "probeImage", "video", "answerImage"]:
            if q.get(key):
                assert (output / q[key]).is_file(), (q["id"], key)
        for choice in q.get("choices", []) + q.get("elements", []):
            if choice.get("image"):
                assert (output / choice["image"]).is_file()
        if q["type"] == "choice":
            assert q["answer"] in {c["id"] for c in q["choices"]}
        if q["type"] == "construction":
            assert set(q["answer"]) <= {c["id"] for c in q["elements"]}
    serialized = json.dumps(bank, ensure_ascii=False)
    assert "/Users/" not in serialized and "assets/raw/" not in serialized


def write_attributions(sources, output):
    cards = []
    for source in sources:
        license_link = f'<a href="{html.escape(source["licenseFile"])}">许可原文</a>' if source.get("licenseFile") else ""
        cards.append(f'<section><h2>{html.escape(source["name"])}</h2><p>{html.escape(source.get("authors", ""))}</p><p>{html.escape(source["license"])} · {license_link}</p><p><a href="{html.escape(source["url"])}">原始来源</a></p></section>')
    (output / "attributions.html").write_text('''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>来源与许可 · 思维练习室</title><style>body{font:16px/1.8 system-ui,sans-serif;max-width:850px;margin:48px auto;padding:0 24px;color:#18232d;background:#f7f9fb}a{color:#236e65}h1,h2{line-height:1.35}h2{font-size:21px}section{background:white;border-radius:16px;padding:18px 24px;margin:18px 0;box-shadow:0 0 0 1px #00000010}p{margin:8px 0}</style><a href="./">← 返回练习</a><h1>来源与许可</h1><p>本网站用于个人与非商业练习。程序代码按 GPL-3.0 发布，各题库、图像及视频保留各自许可。MaRs-IB 图像采用 CC BY-NC 3.0，包含非商业限制。</p><p>中文说明、统一练习分档、序列显示节奏、自动组题和动画孔数问题为本项目整理或改编；原始难度另行保留。部分源解释可能有标注误差。</p><p>未找到明确再分发许可的 51 张 ACCES 图片未纳入本站。练习记录保存在当前浏览器，不上传服务器。</p>''' + "".join(cards) + "</html>\n")


if __name__ == "__main__":
    main()
