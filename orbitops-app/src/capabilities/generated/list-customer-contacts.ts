import type {
  CapabilityDefinition
} from "../../types.js";

export const listCustomerContactsCapability = {
  "key": "listCustomerContacts",
  "title": "联系人列表",
  "mode": "read",
  "output": {
    "customerAccountId": {
      "type": "string",
      "description": "Reference to one related customerAccount record."
    },
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
    "id": {
      "type": "string",
      "required": true,
      "description": "Stable identifier for one customerContact record."
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
  "resources": [
    "customerContact"
  ],
  "policy": "tenantScoped"
} satisfies CapabilityDefinition;
