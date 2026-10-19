import { ethers } from "ethers";
import { config } from "../config/index.js";
import { SBT_ABI, REGISTRY_ABI, SPLITS_ABI, LABEL_ABI } from "../abi/index.js";

let provider;
export const contracts = {};

try {
  provider = new ethers.JsonRpcProvider(config.polygonRpcUrl);
  
  if (config.contracts.sbt) {
    contracts.sbt = new ethers.Contract(config.contracts.sbt, SBT_ABI, provider);
  }
  if (config.contracts.registry) {
    contracts.registry = new ethers.Contract(config.contracts.registry, REGISTRY_ABI, provider);
  }
  if (config.contracts.splits) {
    contracts.splits = new ethers.Contract(config.contracts.splits, SPLITS_ABI, provider);
  }
  if (config.contracts.label) {
    contracts.label = new ethers.Contract(config.contracts.label, LABEL_ABI, provider);
  }
} catch (error) {
  console.error("❌ Failed to connect to blockchain:", error.message);
}

// True, только если адреса контрактов заданы в env; на инстансах без
// chain-слоя (прод RF-эры) остаётся false — хендлеры отвечают graceful-текстом.
export const chainEnabled = Boolean(contracts.sbt && contracts.registry && contracts.splits && contracts.label);

export const statusMap = {
  sbt: { 0: "Active", 1: "Suspended", 2: "Revoked" },
  verificationType: { 0: "Independent", 1: "Label" },
  track: { 0: "Pending", 1: "Verified", 2: "Disputed", 3: "Rejected" },
  label: { 0: "Pending", 1: "Active", 2: "Suspended", 3: "Revoked" }
};
