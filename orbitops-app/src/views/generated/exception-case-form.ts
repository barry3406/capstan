import type { ViewDefinition } from "../../types.js";

export const exceptionCaseFormView = {
  "key": "exceptionCaseForm",
  "title": "创建异常案例",
  "kind": "form",
  "resource": "exceptionCase",
  "capability": "upsertExceptionCase"
} satisfies ViewDefinition;
