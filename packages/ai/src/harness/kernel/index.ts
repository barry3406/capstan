// Kernel barrel — namespace re-exports to avoid name collisions
// (account-pool has inline duplicates of KernelSession, GuardFn, etc.)
export * as session from './session/index.js';
export * as engine from './engine/index.js';
export * as stealth from './stealth/index.js';
export * as guard from './guard/index.js';
export * as ai from './ai/index.js';
export * as di from './di/index.js';
export * as aop from './aop/index.js';
export * as accountPool from './account-pool/index.js';
export * as adapter from './adapter/index.js';
