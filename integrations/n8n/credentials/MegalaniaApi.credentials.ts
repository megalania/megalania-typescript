import type { IAuthenticateGeneric, Icon, ICredentialTestRequest, ICredentialType, INodeProperties } from "n8n-workflow";

export class MegalaniaApi implements ICredentialType {
  name = "megalaniaApi";

  displayName = "Megalania API";

  icon: Icon = { light: "file:megalania.svg", dark: "file:megalania.svg" };

  documentationUrl = "https://docs.megalania.io/integrations/n8n";

  properties: INodeProperties[] = [
    {
      displayName: "API Key",
      name: "apiKey",
      type: "string",
      typeOptions: { password: true },
      default: "",
      required: true,
      description: "A key that starts with meg_sk_, from the API keys page of the dashboard",
    },
    {
      displayName: "Scrape Host",
      name: "baseUrl",
      type: "string",
      default: "https://get.megalania.io",
    },
    {
      displayName: "Batch Host",
      name: "apiUrl",
      type: "string",
      default: "https://api.megalania.io",
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: {
        Authorization: "=Bearer {{$credentials.apiKey}}",
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: "={{$credentials.apiUrl}}",
      url: "/v1/batches",
      qs: { limit: 1 },
    },
  };
}
