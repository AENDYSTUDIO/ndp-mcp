// Зеркало Merkle-алгоритма эпох (A7, §7.27) для MCP-контура: офлайн-проверка
// proof включения трека в заякоренную эпоху без доверия к БД реестра.
// Алгоритм идентичен services/registry-api/epoch_merkle.py и
// chaincode/ndp-anchor/merkle.go (VerifyInclusion): узел =
// SHA-256(байты(left_hex) ‖ байты(right_hex)); при нечётном числе узлов
// уровня последний дублируется. Кросс-вектор зафиксирован в test-merkle.js
// (те же константы, что в тестах Python и Go — менять синхронно).
import { createHash } from "node:crypto";

export function hashPair(leftHex, rightHex) {
  return createHash("sha256")
    .update(Buffer.concat([
      Buffer.from(leftHex, "hex"),
      Buffer.from(rightHex, "hex"),
    ]))
    .digest("hex");
}

export function buildMerkleRoot(leafHexes) {
  const level = [...leafHexes];
  if (!level.length) return "";
  while (level.length > 1) {
    if (level.length % 2) level.push(level[level.length - 1]);
    for (let i = 0; i < level.length; i += 2) {
      level[i / 2] = hashPair(level[i], level[i + 1]);
    }
    level.length = Math.ceil(level.length / 2);
  }
  return level[0];
}

export function buildMerkleProof(leafHexes, idx) {
  if (!leafHexes.length || idx < 0 || idx >= leafHexes.length) {
    throw new Error("индекс листа вне диапазона");
  }
  const level = [...leafHexes];
  const proof = [];
  let cur = idx;
  while (level.length > 1) {
    if (level.length % 2) level.push(level[level.length - 1]);
    const sib = cur % 2 === 0 ? cur + 1 : cur - 1;
    proof.push({ hash: level[sib], left: cur % 2 === 1 });
    for (let i = 0; i < level.length; i += 2) {
      level[i / 2] = hashPair(level[i], level[i + 1]);
    }
    level.length = Math.ceil(level.length / 2);
    cur = Math.floor(cur / 2);
  }
  return proof;
}

// proof: [{hash, left}] от листа до корня; left=true — сосед слева (hash‖cur).
export function verifyMerkleProof(leafHex, proof, root) {
  try {
    let cur = leafHex;
    for (const step of proof) {
      cur = step.left ? hashPair(step.hash, cur) : hashPair(cur, step.hash);
    }
    return cur === root;
  } catch {
    return false;
  }
}
