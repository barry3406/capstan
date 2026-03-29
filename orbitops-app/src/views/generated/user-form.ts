import type { ViewDefinition } from "../../types.js";

export const userFormView = {
  "key": "userForm",
  "title": "Invite User",
  "kind": "form",
  "resource": "user",
  "capability": "inviteUser"
} satisfies ViewDefinition;
