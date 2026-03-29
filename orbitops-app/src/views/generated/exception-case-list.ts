import type { ViewDefinition } from "../../types.js";

export const exceptionCaseListView = {
  "key": "exceptionCaseList",
  "title": "异常案例列表",
  "kind": "list",
  "resource": "exceptionCase",
  "capability": "listExceptionCases"
} satisfies ViewDefinition;
