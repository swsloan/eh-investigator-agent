---
{
  "anchor": "dataset",
  "api_area": "trigger-api",
  "doc_kind": "class",
  "events": [],
  "examples": [],
  "methods": [
    "percentile(...): Array | Number"
  ],
  "name": "Dataset",
  "properties": [
    "entries: Array"
  ],
  "section": "datastore-classes",
  "source_url": "https://docs.extrahop.com/current/extrahop-trigger-api/",
  "source_version": "26.2"
}
---

### Dataset

The dataset class enables you to access raw dataset values and provides an interface for computing percentiles.

#### Instance Methods

- **percentile(...): Array | Number**: Accepts a list of percentiles (either as an array or as multiple arguments) to compute and returns the computed percentile values for the dataset. If passed a single numeric argument, a number is returned. Otherwise an array is returned. The arguments must be in ascending order with no duplicates. Floating point values, such as 99.99, are allowed.

#### Instance Properties

- **entries: Array**: An array of objects with frequency and value attributes. This is analogous to a frequency table where there is a set of values and the number of times each value was observed.
