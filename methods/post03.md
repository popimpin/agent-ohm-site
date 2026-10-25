# Post 03 - A 30B model on a 4 GB laptop GPU

Measured 2026-10-25 (live take 11:13; llama-bench sweeps 11:20-12:10) - laptop on AC, Windows 11.

```
llama-server -m Qwen3-30B-A3B-Instruct-2507-UD-Q3_K_XL.gguf -ngl 99 --n-cpu-moe 48 -t 12 -fa on -c 8192
```

- GPU: NVIDIA RTX 3050 Ti Laptop, 4 GB
- CPU: Intel i7-12700H
- RAM: 24 GB DDR5-4800
- Model: [Qwen3-30B-A3B-Instruct-2507-UD-Q3_K_XL.gguf](https://huggingface.co/unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF) (13.8 GB), 30.5B total, 3.3B active per token
- Runtime: [llama.cpp](https://github.com/ggml-org/llama.cpp) b11172 (CUDA 12.4)

| run | tokens/s | prompt tokens/s | GPU memory |
|---|---|---|---|
| live, streaming + recording the screen (the post) | 17.6 | - | 1.82 GB |
| benchmark, all experts in RAM (5 runs) | 17-27 | 353.5 | 2.01 GB |
| 8 expert layers on the card (--n-cpu-moe 40) | 24.4 | - | 3.16 GB |
| 12 expert layers on the card (--n-cpu-moe 36) | 26.8 | - | 3.84 GB |

The trick is llama.cpp's own option, --n-cpu-moe: it keeps the experts' weights in system RAM and the rest on the GPU. We measured it on this laptop; we did not invent it.

## No NVIDIA card? Vulkan

Measured 2026-10-24 22:41 EDT (llama-bench on the machine; flm paused for the run and restarted).

```
llama-bench -m Qwen3-30B-A3B-Instruct-2507-UD-Q3_K_XL.gguf -ngl 99 -fa 1 -t 10 -lm none --no-host 1 --n-cpu-moe 12
```

- GPU: AMD Radeon 880M, integrated (RDNA 3.5, gfx1150; the Vulkan driver reports it as 'Radeon 890M Graphics') - 512 MiB of its own memory + an 11.3 GiB window into system RAM
- CPU: AMD Ryzen AI 9 365 (lscpu on the machine)
- RAM: 24 GB, shared with the GPU (22.6 GiB usable)
- Runtime: [llama.cpp](https://github.com/ggml-org/llama.cpp) b11172 (Vulkan)

Every run first failed with 'radv/amdgpu: Not enough memory for command submission' - even with all experts on the CPU. llama.cpp pins the CPU-side weights as Vulkan host buffers, and on an integrated GPU that pinned ~12 GB overflows the GPU's shared-memory window.

**Fix:** --no-host 1 (keep the CPU-side weights in plain RAM) and -lm none. With those, the same 30B file runs on a laptop iGPU that has half a gigabyte of its own memory.

| run | tokens/s | prompt tokens/s | GPU memory |
|---|---|---|---|
| short context | 29.3 | 275.7 | shared RAM |
| 8K context, q8 KV cache (-ctk q8_0 -ctv q8_0 -d 8192) | 24.4 | 174.8 | shared RAM |
