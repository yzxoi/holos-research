# Inspire Compute Policy

---

## Instance Type

- **Experiment** → `inspire_submit` (training task) — records `code_commit`, auto-tracks lifecycle
- **Debug/dev** → `inspire_notebook` — interactive, no automated tracking

---

## Compute Resources

Run `inspire_status()` to discover your project's available GPUs and compute groups.

### GPU selection

1. **Pilot / single-GPU** → any GPU with free slots — computing with internet access is convenient for debugging, but idle GPU always beats queued GPU
2. **Large model train** → prefer the GPU with the most VRAM; fall back to next-best VRAM if full
3. **Multi-GPU** → prefer the GPU with most VRAM per card for headroom
4. **Non-CUDA GPUs** (e.g. ASCEND, PPU) → only use if the research targets that hardware stack

### Known compute groups (verify via `inspire_status()`)

| GPU | VRAM | Typical space | Internet |
|-----|------|-------------|----------|
| 4090 | 48GB | 可上网GPU资源 | Yes |
| H200 SXM | 141GB | 分布式训练空间 | No |
| H100 SXM | 80GB | 分布式训练空间 | No |

### CPU tasks

| Workload | Where |
|----------|-------|
| Quick (< 30 min) | Local `bash` |
| Long local (> 30 min) | `nohup` background + log file + `agenda_watch` (saves session resources) |
| Longer, needs internet | `CPU资源空间`, low priority (1-3, free tier) |
| Large-scale, offline | `高性能计算` HPC (Slurm image required) |

---

## Image Building

### Rule

Every research project needs its own Docker image with all deps pre-installed. Generic platform images (`pytorch2.5-cuda12.4`) are NOT acceptable for registered experiments — platform images change over weeks/months, breaking reproducibility.

### Choose docker or buildah by environment

| Environment | Use | Reason |
|-------------|-----|--------|
| Dedicated dev machine, Docker daemon running, you have sudo | `docker build` | Faster, standard |
| Shared cluster / HPC / GPU box, no daemon, no cgroup write access | `buildah bud --isolation chroot` | Rootless, no daemon, no cgroup — works where docker can't |

Both produce equivalent OCI images. Buildah is not a "fallback" — on shared machines it's the normal choice.

### docker path

```
docker build -t myproject:v3 -f Dockerfile .
docker tag myproject:v3 docker.sii.shaipower.online/inspire-studio/myproject:v3
docker push docker.sii.shaipower.online/inspire-studio/myproject:v3
```

### buildah path

```
buildah bud --isolation chroot -t myproject:v3 -f Dockerfile .
buildah push myproject:v3 docker://docker.sii.shaipower.online/inspire-studio/myproject:v3
```

`--isolation chroot` avoids the cgroup write permission errors common on shared machines.

### After push (BOTH paths): register the image

On the platform: 镜像管理 → 新建镜像 → fill 镜像名称 (`myproject`) + 版本号 (`v3`). Without this step the platform scheduler cannot find the image, even though it's in the registry.

### Record in `ASSETS.md`

```
| Image | Tag | Key packages | Build date |
|-------|-----|-------------|-----------|
| docker.sii.shaipower.online/inspire-studio/myproject | v3 | torch 2.5.1, transformers 4.45, datasets 3.1 | 2026-05-04 |
```

---

## Submission Rules

```
- Image domain: docker.sii.shaipower.online/... (NOT docker-qb.sii.edu.cn/...)
- Log capture: always 2>&1 | tee /inspire/.../logs/{exp_id}.log
- Offline spaces: no pip install/git clone/wget — all deps in the image
- Shell: source /opt/conda/etc/profile.d/conda.sh && conda activate in every command
- shm: ≥ 65536 for multi-GPU
- commandPrefix: never set (Synergy-wide global)
```

---

## Command Templates

### 4090 (可上网GPU资源):
```
inspire_submit(
  name="exp_007",
  workspace="可上网GPU资源",
  compute_group="<from inspire_status>",
  spec="<from inspire_status>",
  image="docker.sii.shaipower.online/inspire-studio/myproject:v3",
  command="source /opt/conda/etc/profile.d/conda.sh && conda activate myenv && cd /inspire/hdd/project/{en_name}/code && python train.py --seed 42 2>&1 | tee /inspire/hdd/project/{en_name}/logs/exp_007.log",
  priority=9)
```

### H200/H100 (分布式训练空间, offline):
```
inspire_submit(
  name="exp_008",
  workspace="分布式训练空间",
  compute_group="<from inspire_status>",
  spec="<from inspire_status>",
  image="docker.sii.shaipower.online/inspire-studio/myproject:v3",
  command="source /opt/conda/etc/profile.d/conda.sh && conda activate myenv && cd /inspire/hdd/project/{en_name}/code && python train.py --config large.yaml --seed 42 2>&1 | tee /inspire/hdd/project/{en_name}/logs/exp_008.log",
  shm=65536,
  priority=9)
```

### CPU (CPU资源空间, online, free tier):
```
inspire_submit(
  name="eval-exp007",
  workspace="CPU资源空间",
  compute_group="CPU资源-2",
  spec="<cpu_spec_id>",
  command="source /opt/conda/etc/profile.d/conda.sh && conda activate myenv && cd /inspire/hdd/project/{en_name}/code && python eval.py 2>&1 | tee /inspire/hdd/project/{en_name}/logs/eval-exp007.log",
  priority=3)
```

### HPC (高性能计算, offline, multi-node CPU):
```
inspire_submit_hpc(
  name="preprocess",
  workspace="高性能计算",
  compute_group="高性能计算",
  spec="<hpc_spec_id>",
  image="docker.sii.shaipower.online/inspire-studio/slurm-xxx:tag",
  entrypoint="source /opt/conda/etc/profile.d/conda.sh && conda activate myenv && bash scripts/preprocess.sh")
```

---

## Common Pitfalls

| Pitfall | Fix |
|---------|-----|
| Image not found | 镜像管理 → 新建镜像 |
| `pip install` / `git clone` in command | Pre-build image with all deps |
| `conda: command not found` | `source /opt/conda/etc/profile.d/conda.sh` first in command |
| Docker build: cgroup permission error | Switch to `buildah bud --isolation chroot` — this is the normal build method on shared machines |
| Notebook killed | Use `inspire_submit` for experiments |
| Changed `commandPrefix` | Full env init in every `command`, never set it |
