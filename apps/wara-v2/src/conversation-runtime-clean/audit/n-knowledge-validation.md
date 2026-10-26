# N — Knowledge validation boundary

Included seeds are short operational navigation facts already catalogued in F1. They retain source and version and are not conversational patches.

Excluded by construction:

- traces, datasets, prompts, tests and conversation-specific fixes;
- PDFs or uploaded documents (no automatic ingestion);
- tenant/company documents until a product owner validates scope, freshness and confidentiality;
- credentials, URLs with tokens, backend payloads and customer data.

The `KnowledgeExtractor` port is intentionally unimplemented for production. A future extractor must produce passages for human review before repository publication. Retrieval is deterministic and returns evidence only; Interpreter/Controller remain responsible for meaning and task selection.
