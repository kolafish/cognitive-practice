---
language: en
license: cc-by-4.0
size_categories:
- n<1K
task_categories:
- visual-question-answering
- question-answering
- video-text-to-text
task_ids:
- task-planning
dataset_type: benchmark
tags:
- reasoning
- spatial
- visualization
- symmetry
- rotation
- 3D
- animation
dataset_info:
- config_name: planning
  features:
  - name: resultHoles
    dtype: string
  - name: numberofFoldingSteps
    dtype: int64
  - name: taskType
    dtype: string
  - name: id
    dtype: string
  - name: totalNumberofHoles
    dtype: int64
  - name: resultImg
    dtype: string
  splits:
  - name: train
    num_bytes: 240571
    num_examples: 400
  download_size: 36214
  dataset_size: 240571
- config_name: prediction
  features:
  - name: resultHoles
    dtype: string
  - name: numberofFoldingSteps
    dtype: int64
  - name: taskType
    dtype: string
  - name: foldingVideo
    dtype: string
  - name: foldingFrames
    dtype: string
  - name: unfoldingTypes
    sequence: string
  - name: foldingTypes
    dtype: string
  - name: id
    dtype: string
  - name: totalNumberofHoles
    dtype: int64
  - name: unfoldingVideo
    dtype: string
  - name: unfoldingFrames
    dtype: string
  - name: resultImg
    dtype: string
  - name: initialHoles
    dtype: string
  splits:
  - name: train
    num_bytes: 2436961
    num_examples: 900
  download_size: 319542
  dataset_size: 2436961
configs:
- config_name: planning
  data_files:
  - split: train
    path: planning/train-*
- config_name: prediction
  data_files:
  - split: train
    path: prediction/train-*
---


# MentalBlackboard Benchmark 

Spatial visualization is the mental ability to imagine, transform, and manipulate the spatial characteristics of objects and actions. This intelligence is a part of human cognition where actions and perception are connected on a mental level. To explore whether state-of-the-art Vision-Language Models (VLMs) exhibit this ability, we develop MentalBlackboard, an open-ended spatial visualization benchmark for Paper Folding and Hole Punching tests within two core tasks: prediction and planning. 

- 
### Dataset Description

- **Curated by:** Nilay Yilmaz
- **Language(s) (NLP):** English
- **License:** cc
- **Contact:** nyilmaz3@asu.edu

### Dataset Sources 

<!-- Provide the basic links for the dataset. -->

- **Website:** https://mentalblackboard.github.io/
- **Repository:** https://github.com/nlylmz/MentalBlackboard
- **Paper :** 	MentalBlackboard: Evaluating Spatial Visualization via Mathematical Transformations


## Configurations

- `prediction`: 900 paper folding questions, showing folding sequences and hole punching, and asking for the final unfolded paper shape.
- `planning`: 400 visual questions showing the final unfolded paper, requesting folding sequences and hole properties.

All configurations expose a single `train` split.

## Loading

```python
from datasets import load_dataset

prediction = load_dataset("nlylmz/Mentalblackboard", "prediction")
planning = load_dataset("nlylmz/MentalBlackboard", "planning")
```

## Citation

**BibTeX:**
```
@misc{yilmaz2026mentalblackboardevaluatingspatialvisualization,
      title={MentalBlackboard: Evaluating Spatial Visualization via Mathematical Transformations}, 
      author={Nilay Yilmaz and Maitreya Patel and Naga Sai Abhiram Kusumba and Yixuan He and Yezhou Yang},
      year={2026},
      eprint={2602.19357},
      archivePrefix={arXiv},
      primaryClass={cs.CV},
      url={https://arxiv.org/abs/2602.19357}, 
}
```