"""Exact bytes per tensor in the post 03 GGUF (sizes from data offsets - no quant-type table needed), grouped into what
--n-cpu-moe 48 puts in RAM (routed experts, ffn_*_exps) vs on the GPU (everything else), and the bytes ONE token must read.
Facts used: expert_count 128, expert_used_count 8 (from the file's own metadata)."""
import struct, os, re, json, collections
P = 'C:/ohm_local_ai/models/Qwen3-30B-A3B-Instruct-2507-UD-Q3_K_XL.gguf'
f = open(P, 'rb'); assert f.read(4) == b'GGUF'
ver, = struct.unpack('<I', f.read(4)); nt, nkv = struct.unpack('<QQ', f.read(16))
rs = lambda: f.read(struct.unpack('<Q', f.read(8))[0]).decode('utf-8', 'replace')
SZ = {0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8}; FM = {0: 'B', 1: 'b', 2: 'H', 3: 'h', 4: 'I', 5: 'i', 6: 'f', 7: '?', 10: 'Q', 11: 'q', 12: 'd'}
meta = {}
def rv(t):
    if t == 8: return rs()
    if t == 9:
        et, = struct.unpack('<I', f.read(4)); n, = struct.unpack('<Q', f.read(8))
        if et == 8: [rs() for _ in range(n)]
        else: f.read(SZ[et] * n)
        return None
    return struct.unpack('<' + FM[t], f.read(SZ[t]))[0]
for _ in range(nkv):
    k = rs(); t, = struct.unpack('<I', f.read(4)); meta[k] = rv(t)
align = meta.get('general.alignment') or 32
T = []
for _ in range(nt):
    name = rs(); nd, = struct.unpack('<I', f.read(4)); dims = struct.unpack('<' + 'Q' * nd, f.read(8 * nd))
    typ, off = struct.unpack('<IQ', f.read(12)); T.append([name, dims, typ, off])
base = (f.tell() + align - 1) // align * align
end = os.path.getsize(P)
T.sort(key=lambda x: x[3])
for i, t in enumerate(T):
    t.append((T[i + 1][3] if i + 1 < len(T) else end - base) - t[3])
E, U = meta['qwen3moe.expert_count'], meta['qwen3moe.expert_used_count']
g = collections.Counter(); types = collections.defaultdict(collections.Counter)
for name, dims, typ, off, size in T:
    kind = 'experts_routed' if re.search(r'ffn_(gate|up|down)_exps', name) else 'everything_else'
    g[kind] += size; types[kind][typ] += size
ram, gpu = g['experts_routed'], g['everything_else']
active_ram = ram * U / E
out = {'file_bytes': end, 'tensor_bytes': ram + gpu, 'experts_routed_bytes (RAM with --n-cpu-moe 48)': ram,
       'everything_else_bytes (GPU weights)': gpu, 'experts read per token (8/128 of every layer)': active_ram,
       'GB': {k: round(v / 1e9, 3) for k, v in {'file': end, 'experts_RAM': ram, 'weights_GPU': gpu, 'expert_bytes_per_token': active_ram}.items()},
       'quant_types_by_group(ggml type id -> GB)': {k: {str(t): round(v / 1e9, 3) for t, v in c.items()} for k, c in types.items()}}
print(json.dumps(out, indent=1))
json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'gguf_bytes.json'), 'w'), indent=1)
