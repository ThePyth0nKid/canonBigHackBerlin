# Eval Results — Inazuma Gold Test Set

Gold examples: 77

| Label | Pioneer GLiNER-2 (zero-shot) | Gemini 2.5-flash (frontier) | Ours: Pioneer-deployed (Agent-trained) | Ours: Modal (open gliner_large-v2.1, ours params) |
|---|---|---|---|---|
| EMPLOYEE | 0.76 | 0.91 | 0.89 | 0.89 |
| EMPLOYEE_ID | 0.52 | 1.00 | 0.38 | 1.00 |
| CUSTOMER_ID | 0.33 | 0.97 | 0.43 | 1.00 |
| PRODUCT_ID | 0.32 | 1.00 | 0.40 | 1.00 |
| TICKET_ID | 0.70 | 1.00 | 0.29 | 1.00 |
| THREAD_ID | 0.89 | 1.00 | 0.34 | 1.00 |
| AMOUNT | 0.84 | 1.00 | 0.74 | 1.00 |
| DEPARTMENT | 0.58 | 0.93 | 0.77 | 0.92 |
| POLICY_NAME | 0.33 | 1.00 | 0.24 | 0.94 |
| DATE | 0.71 | 0.86 | 0.69 | 0.80 |
| **MACRO-F1** | **0.596** | **0.967** | **0.518** | **0.955** |