#!/bin/bash
# Deploy the fine-tuned model as a Modal web endpoint.
# After this runs, GLINER_FT_ENDPOINT can be set to the printed URL.
#
# Run AFTER training completes (04_finetune_modal.py).
set -e
export PATH="$HOME/Library/Python/3.9/bin:$PATH"

cd "$(dirname "$0")/.."

echo "Deploying GLiNER FT inference endpoint..."
modal deploy scripts/04_finetune_modal.py 2>&1 | tee /tmp/modal-deploy.log

echo ""
echo "✓ Endpoint deployed. Look for the predict.web_url printed above."
echo "Next:"
echo "  echo 'GLINER_FT_ENDPOINT=<url>' >> .env.local"
echo "  python3 scripts/06_demo.py 'Hi Ravi, customer arout placed order B07JW9H4J1 for ₹399 on 2024-12-15.'"
