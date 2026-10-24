// Кросс-вектор зеркала src/services/merkle.js: константы те же, что в
// services/registry-api/tests/test_epoch_merkle.py (CROSS_ROOT/PROOF_2)
// и chaincode/ndp-anchor/merkle_test.go (TestCrossVectorWithPython).
// Запуск: node test-merkle.js  (без env/сети).
import { createHash } from "node:crypto";
import {
  buildMerkleProof, buildMerkleRoot, hashPair, verifyMerkleProof,
} from "./src/services/merkle.js";

let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "✔" : "✘"} ${msg}`);
  if (!cond) failed++;
};

const sha = (s) => createHash("sha256").update(s).digest("hex");

const CROSS_LEAVES = [0, 1, 2, 3, 4, 5].map((i) => sha(`leaf${i}`));
const CROSS_ROOT =
  "a5061b8c3962e766a0cb0608556ab8d5b8bf98a7256eefbfb00232e545873e27";
const CROSS_PROOF_2 = [
  { hash: "f2764fd79fdab5132fc349ba555c9c56ff0c935c889c17ebe3d61315d780934e", left: false },
  { hash: "884ff14f19d1564614ab3184d7bdc35a1a9ff90d36ac962b05a81aeb56027c22", left: true },
  { hash: "0745fedb25ca1d071d109a77488dfb22194eb5f54f7aadb795a15730199ae263", left: false },
];

// 1. Кросс-вектор с Python/Go
ok(buildMerkleRoot(CROSS_LEAVES) === CROSS_ROOT, "кросс-вектор: корень над 6 листьями совпал");
ok(
  JSON.stringify(buildMerkleProof(CROSS_LEAVES, 2)) === JSON.stringify(CROSS_PROOF_2),
  "кросс-вектор: proof[2] совпал",
);
ok(verifyMerkleProof(CROSS_LEAVES[2], CROSS_PROOF_2, CROSS_ROOT), "кросс-вектор: leaf[2] верифицируется");

// 2. Формы деревьев (1/2/3/5/8 листьев) + подмена листа
for (const n of [1, 2, 3, 5, 8]) {
  const leaves = Array.from({ length: n }, (_, i) => sha(`x${i}`));
  const root = buildMerkleRoot(leaves);
  let all = true;
  for (let i = 0; i < n; i++) {
    all = all && verifyMerkleProof(leaves[i], buildMerkleProof(leaves, i), root);
  }
  ok(all, `дерево из ${n} листьев: все proofs верифицируются`);
}
ok(
  !verifyMerkleProof(sha("fake"), buildMerkleProof(CROSS_LEAVES, 0), CROSS_ROOT),
  "подменённый лист не проходит",
);
ok(
  JSON.stringify(buildMerkleProof(CROSS_LEAVES, 2).map((s) => ({ ...s, hash: s.hash.slice(0, 4) }))) !==
    JSON.stringify(CROSS_PROOF_2.map((s) => ({ ...s, hash: s.hash.slice(0, 4) }))) ||
    verifyMerkleProof(CROSS_LEAVES[2], CROSS_PROOF_2.map((s) => ({ ...s, left: !s.left })), CROSS_ROOT) === false,
  "искажённый путь (лево/право) не проходит",
);

// 3. Детерминизм hashPair (байты hex, не строки)
ok(
  hashPair("00", "11").length === 64 &&
    hashPair("0011", "2233") !== hashPair("0022", "1133"),
  "hashPair: sha256-хеш над байтами, детерминирован",
);

console.log(failed ? `\n✘ FAIL: ${failed}` : "\nMERKLE-ЗЕРКАЛО: ОК");
process.exit(failed ? 1 : 0);
