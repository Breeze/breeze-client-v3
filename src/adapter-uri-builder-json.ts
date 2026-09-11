import * as breeze from './breeze.js';
import { appendQueryStringParameter } from './adapter-core.js';

export class UriBuilderJsonAdapter implements breeze.UriBuilderAdapter {
  name: string;

  constructor() {
    this.name = "json";
  }

  static register(config?: breeze.BreezeConfig) {
    config = config || breeze.config;
    config.registerAdapter("uriBuilder", UriBuilderJsonAdapter);
    return config.initializeAdapterInstance("uriBuilder", "json", true) as UriBuilderJsonAdapter;
  }

  initialize() {}

  buildUri(entityQuery: breeze.EntityQuery, metadataStore: breeze.MetadataStore) {
    // force entityType validation;
    let entityType = entityQuery._getFromEntityType(metadataStore, false);
    if (!entityType) entityType = new breeze.EntityType(metadataStore);
    let json = entityQuery.toJSONExt( { entityType: entityType, toNameOnServer: true}) as any;
    json.from = undefined;
    json.queryOptions = undefined;
    // withParameters values are sent once, as ordinary query-string arguments (the data
    // service adapter passes them as request params). That is where the server's model
    // binding reads them; a copy inside the JSON was never read.
    json.parameters = undefined;

    let jsonString = JSON.stringify(json);
    if (jsonString.length > 2) {
      let urlBody = encodeURIComponent(jsonString);
      return appendQueryStringParameter(entityQuery.resourceName!, urlBody);
    } else {
      return entityQuery.resourceName!;
    }

  }

}

// NOTE: this module deliberately does NOT register itself on import.
// Registration is explicit - pass the adapter to configureBreeze, or call
// SomeAdapter.register(). Importing a module should not mutate global state.




