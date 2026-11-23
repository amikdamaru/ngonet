// Pencarian jalur Onet Classic.
//
// Papan rows x cols dibungkus satu lapisan sel kosong virtual (virtual border),
// sehingga koordinat jalur berada pada rentang baris -1..rows dan kolom -1..cols.
// Algoritma: 0-1 BFS atas state (baris, kolom, arah). Bergerak lurus berbiaya 0,
// berbelok berbiaya 1. State dengan belokan > maxTurns dibuang. Karena 0-1 BFS
// selalu memproses state berbiaya terkecil lebih dulu, jalur yang ditemukan
// memiliki jumlah belokan minimum.

const DIRS = [
  [-1, 0], // 0: atas
  [0, 1],  // 1: kanan
  [1, 0],  // 2: bawah
  [0, -1], // 3: kiri
];

/**
 * @param {(r:number,c:number)=>boolean} isEmpty  true jika sel papan (dalam batas) kosong
 * @param {number} rows
 * @param {number} cols
 * @param {{r:number,c:number}} a  tile awal
 * @param {{r:number,c:number}} b  tile tujuan
 * @param {number} maxTurns
 * @returns {null | {turns:number, points:{r:number,c:number}[]}}
 *   points = titik awal, titik-titik belokan, titik akhir (koordinat papan, bisa -1 / rows / cols)
 */
export function findPath(isEmpty, rows, cols, a, b, maxTurns = 2) {
  if (a.r === b.r && a.c === b.c) return null;

  const H = rows + 2;
  const W = cols + 2;
  // indeks state = ((r+1) * W + (c+1)) * 4 + dir
  const size = H * W * 4;
  const dist = new Int8Array(size).fill(127);
  const parent = new Int32Array(size).fill(-1);

  const inPadded = (r, c) => r >= -1 && r <= rows && c >= -1 && c <= cols;
  const inBoard = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols;
  const passable = (r, c) => {
    if (!inPadded(r, c)) return false;
    if (r === b.r && c === b.c) return true;
    if (!inBoard(r, c)) return true; // area virtual di luar papan selalu kosong
    return isEmpty(r, c);
  };
  const key = (r, c, d) => (((r + 1) * W) + (c + 1)) * 4 + d;

  // deque sederhana berbasis array dengan dua pointer
  // Setiap state bisa di-push paling banyak (maxTurns + 1) kali (setiap kali biayanya membaik).
  const maxPush = size * (maxTurns + 1) + 8;
  const dq = new Int32Array(maxPush * 2);
  let head = maxPush;
  let tail = maxPush;
  const pushFront = (k) => { dq[--head] = k; };
  const pushBack = (k) => { dq[tail++] = k; };

  for (let d = 0; d < 4; d++) {
    const nr = a.r + DIRS[d][0];
    const nc = a.c + DIRS[d][1];
    if (!passable(nr, nc)) continue;
    const k = key(nr, nc, d);
    dist[k] = 0;
    parent[k] = -2; // langsung dari titik awal
    pushBack(k);
  }

  let found = -1;
  while (head < tail) {
    const k = dq[head++];
    const d = k & 3;
    const cell = k >> 2;
    const r = Math.floor(cell / W) - 1;
    const c = (cell % W) - 1;
    const cost = dist[k];
    if (r === b.r && c === b.c) { found = k; break; }

    for (let nd = 0; nd < 4; nd++) {
      if (nd === ((d + 2) & 3)) continue; // tidak boleh berbalik arah
      const ncost = cost + (nd === d ? 0 : 1);
      if (ncost > maxTurns) continue;
      const nr = r + DIRS[nd][0];
      const nc = c + DIRS[nd][1];
      if (!passable(nr, nc)) continue;
      const nk = key(nr, nc, nd);
      if (ncost < dist[nk]) {
        dist[nk] = ncost;
        parent[nk] = k;
        if (nd === d) pushFront(nk); else pushBack(nk);
      }
    }
  }
  if (found < 0) return null;

  // Rekonstruksi jalur sel per sel, lalu kompres menjadi titik belokan.
  const cells = [];
  let k = found;
  while (k >= 0) {
    const cell = k >> 2;
    cells.push({ r: Math.floor(cell / W) - 1, c: (cell % W) - 1 });
    k = parent[k];
  }
  cells.push({ r: a.r, c: a.c });
  cells.reverse();

  return { turns: dist[found], points: compress(cells), cells };
}

function compress(cells) {
  if (cells.length <= 2) return cells.slice();
  const out = [cells[0]];
  for (let i = 1; i < cells.length - 1; i++) {
    const p = cells[i - 1], q = cells[i], s = cells[i + 1];
    const d1r = q.r - p.r, d1c = q.c - p.c;
    const d2r = s.r - q.r, d2c = s.c - q.c;
    if (d1r !== d2r || d1c !== d2c) out.push(q);
  }
  out.push(cells[cells.length - 1]);
  return out;
}

/**
 * Validasi independen sebuah jalur (dipakai oleh test): hanya langkah ortogonal
 * satu sel, tidak menembus tile, belokan <= maxTurns, tetap di dalam virtual border.
 */
export function validatePath(isEmpty, rows, cols, a, b, cells, maxTurns = 2) {
  if (!cells || cells.length < 2) return false;
  const first = cells[0], last = cells[cells.length - 1];
  if (first.r !== a.r || first.c !== a.c || last.r !== b.r || last.c !== b.c) return false;
  let turns = 0;
  let prevDir = null;
  for (let i = 1; i < cells.length; i++) {
    const dr = cells[i].r - cells[i - 1].r;
    const dc = cells[i].c - cells[i - 1].c;
    if (Math.abs(dr) + Math.abs(dc) !== 1) return false;
    const dir = `${dr},${dc}`;
    if (prevDir !== null && dir !== prevDir) turns++;
    prevDir = dir;
    const { r, c } = cells[i];
    if (r < -1 || r > rows || c < -1 || c > cols) return false;
    const isEnd = i === cells.length - 1;
    const inBoard = r >= 0 && r < rows && c >= 0 && c < cols;
    if (!isEnd && inBoard && !isEmpty(r, c)) return false;
  }
  return turns <= maxTurns;
}
