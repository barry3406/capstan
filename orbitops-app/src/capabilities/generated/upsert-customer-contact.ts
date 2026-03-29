import type {
  CapabilityDefinition
} from "../../types.js";

export const upsertCustomerContactCapability = {
  "key": "upsertCustomerContact",
  "title": "创建/编辑联系人",
  "mode": "write",
  "input": {
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
