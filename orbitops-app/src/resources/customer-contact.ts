import type { ResourceDefinition } from "../types.js";

export const customerContactResource = {
  "key": "customerContact",
  "title": "客户联系人",
  "description": "客户账户下的联系人。",
  "fields": {
    "email": {
      "type": "string",
      "required": true,
      "description": "邮箱"
    },
    "firstName": {
      "type": "string",
      "required": true,
      "description": "名"
    },
    "isPrimary": {
      "type": "boolean",
      "required": true,
      "description": "是否主联系人"
    },
    "jobTitle": {
      "type": "string",
      "required": true,
      "description": "职位"
    },
    "lastName": {
      "type": "string",
      "required": true,
      "description": "姓"
    },
    "phone": {
      "type": "string",
      "required": true,
      "description": "电话"
    }
  },
  "relations": {
    "customerAccount": {
      "resource": "customerAccount",
      "kind": "one"
    }
  }
} satisfies ResourceDefinition;
