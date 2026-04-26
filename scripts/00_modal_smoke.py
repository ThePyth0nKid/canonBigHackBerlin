"""Pre-build the Modal image so it's cached for the training run.
Imports gliner + transformers + torch in a containerised CPU function and reports.
Run once: `modal run scripts/00_modal_smoke.py` — saves 5-10 min on first real run.
"""
import modal

app = modal.App("canon-gliner-ft")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "gliner==0.2.16",
        "transformers==4.45.0",
        "torch==2.5.0",
        "accelerate==1.0.0",
        "huggingface_hub",
    )
)


@app.function(image=image, cpu=2.0, timeout=300)
def smoke():
    import gliner, transformers, torch
    return {
        "gliner": gliner.__version__ if hasattr(gliner, "__version__") else "?",
        "transformers": transformers.__version__,
        "torch": torch.__version__,
        "cuda_available": torch.cuda.is_available(),
    }


@app.local_entrypoint()
def main():
    info = smoke.remote()
    print("Modal image OK:", info)
