import { EntityType, NavigationProperty } from './entity-metadata.js';
import { DataServiceAdapter, UriBuilderAdapter } from '../config/interface-registry.js';
import { KeyMapping } from '../manager/entity-manager.js';
import { MappingContext } from '../query/mapping-context.js';
import { assertConfig } from '../core/assert-param.js';
import { config } from '../config/config.js';
import { core, stringEndsWith } from '../core/core.js';

/** Configuration info to be passed to the {@link DataService} constructor */
export interface DataServiceConfig {
  /** The serviceName for this DataService.  */
  serviceName?: string;
  /** The adapter name for the {@link DataServiceAdapter} to be used with this service.  */
  adapterName?: string;
  /** The adapter name for the {@link UriBuilderAdapter} to be used with this service.  */
  uriBuilderName?: string;
  /** Whether the server can provide metadata for this service.  */
  hasServerMetadata?: boolean;
  /** The {@link JsonResultsAdapter} used to process the results of any query against this DataService.  */
  jsonResultsAdapter?: JsonResultsAdapter;
  /** Whether to use JSONP when performing a 'GET' request against this service.
  @deprecated No effect on Breeze's own transport, which has no JSONP support. Kept because it is
  part of a serialized DataService, and because a registered (deprecated) ajax adapter can still
  act on the dataType and crossDomain settings it produces. */
  useJsonp?: boolean;
}
/**
A DataService instance is used to encapsulate the details of a single 'service'; this includes a serviceName, a dataService adapterInstance,
and whether the service has server side metadata.

You can construct an EntityManager with either a serviceName or a DataService instance, if you use a serviceName then a DataService
is constructed for you.  (It can also be set via the EntityManager.setProperties method).

The same applies to the MetadataStore.fetchMetadata method, i.e. it takes either a serviceName or a DataService instance.

Each metadataStore contains a list of DataServices, each accessible via its ‘serviceName’.
( see MetadataStore.getDataService and MetadataStore.addDataService).  The ‘addDataService’ method is called internally
anytime a MetadataStore.fetchMetadata call occurs with a new dataService ( or service name).

*/
export class DataService {
  /** @hidden @internal */
  declare _$typeName: string; // actually put on prototype.
  /** The serviceName for this DataService. __Read Only__ */
  declare serviceName: string;
  /** The adapter name for the {@link DataServiceAdapter} to be used with this service. __Read Only__  */
  declare adapterName: string;
  /**  The {@link DataServiceAdapter} implementation instance associated with this EntityManager. __Read Only__  */
  declare adapterInstance?: DataServiceAdapter;
  /** The adapter name for the {@link UriBuilderAdapter} to be used with this service. __Read Only__  */
  declare uriBuilderName: string;
  /**  The {@link UriBuilderAdapter} implementation instance associated with this EntityManager. __Read Only__  */
  declare uriBuilder?: UriBuilderAdapter;
  /** Whether the server can provide metadata for this service. __Read Only__   */
  declare hasServerMetadata: boolean;
  /** The {@link JsonResultsAdapter} used to process the results of any query against this DataService. __Read Only__ */
  declare jsonResultsAdapter: JsonResultsAdapter;
  /** Whether to use JSONP when performing a 'GET' request against this service. __Read Only__
  @deprecated No effect on Breeze's own transport, which has no JSONP support. Kept because it is
  part of a serialized DataService, and because a registered (deprecated) ajax adapter can still
  act on the dataType and crossDomain settings it produces. */
  declare useJsonp: boolean;

  /**   DataService constructor
  ```ts
  var dataService = new DataService({
      serviceName: altServiceName,
      hasServerMetadata: false
  });
  ```

  ```ts
  var metadataStore = new MetadataStore({
      namingConvention: NamingConvention.camelCase
  });
  ```

  ```ts
  return new EntityManager({
      dataService: dataService,
      metadataStore: metadataStore
  });
  ```
  @param config - A configuration object.
  */
  constructor(config?: DataServiceConfig) {
    updateWithConfig(this, config);
  }


  /**
  Returns a copy of this DataService with the specified properties applied.
  @param config - The configuration object to apply to create a new DataService.
  */
  using(config: DataServiceConfig) {
    if (!config) return this;
    let result = new DataService(this);
    return updateWithConfig(result, config);
  }

  /**
  Combines several DataServices into one, taking each property from the first of them that has it
  set, and filling in the adapters: the named ones, or the defaults. Breeze uses it to combine a
  query's or save's own DataService with the EntityManager's before each request; applications do
  not normally need it.
  @param dataServices - The DataServices to combine, most specific first. Entries may be null or
  undefined. The array is modified.
  @throws if none of them has a `serviceName`.
  */
  static resolve(dataServices: DataService[]) {
    // final defaults
    // Deliberate use of 'as any' below.
    (dataServices as any).push({
      hasServerMetadata: true,
      useJsonp: false
    });
    let ds = new DataService(core.resolveProperties(dataServices,
        ["serviceName", "adapterName", "uriBuilderName", "hasServerMetadata", "jsonResultsAdapter", "useJsonp"]));

    if (!ds.serviceName) {
      throw new Error("Unable to resolve a 'serviceName' for this dataService");
    }
    ds.adapterInstance = ds.adapterInstance || config.getAdapterInstance<DataServiceAdapter>("dataService", ds.adapterName);
    ds.jsonResultsAdapter = ds.jsonResultsAdapter || ds.adapterInstance!.jsonResultsAdapter;
    ds.uriBuilder = ds.uriBuilder || config.getAdapterInstance<UriBuilderAdapter>("uriBuilder", ds.uriBuilderName);
    return ds;
  }

  /** @hidden @internal */
  static _normalizeServiceName(serviceName: string) {
    serviceName = serviceName.trim();
    if (serviceName.substr(-1) !== "/") {
      return serviceName + '/';
    } else {
      return serviceName;
    }
  }

  /**
  Returns the serializable form of this DataService: `serviceName`, `adapterName`,
  `uriBuilderName`, `hasServerMetadata`, `useJsonp` and the `name` of its `jsonResultsAdapter`,
  leaving out any that are not set. `JSON.stringify` calls it when `MetadataStore.exportMetadata`
  and `EntityManager.exportEntities` serialize their DataServices; {@link DataService.fromJSON}
  reads it back.
  */
  toJSON() {
    // don't use default value here - because we want to be able to distinguish undefined props for inheritence purposes.
    return core.toJson(this, {
      serviceName: null,
      adapterName: null,
      uriBuilderName: null,
      hasServerMetadata: null,
      jsonResultsAdapter: function (v: any) {
        return v && v.name;
      },
      useJsonp: null
    });
  }

  /**
  Creates a DataService from the output of {@link DataService.toJSON}. Used when importing metadata
  and exported entities. The `jsonResultsAdapter` name is looked up among the
  {@link JsonResultsAdapter}s created so far, so create a custom one before importing.
  @param json - A serialized DataService. Its `jsonResultsAdapter` property is replaced.
  @throws if the named `jsonResultsAdapter` does not exist.
  */
  static fromJSON(json: any) {
    json.jsonResultsAdapter = config._fetchObject(JsonResultsAdapter, json.jsonResultsAdapter);
    return new DataService(json);
  }

  /**
   Returns a url for this dataService with the specified suffix. This method handles dataService names either
   with or without trailing '/'s.  If the suffix starts with "http" then it will be returned as-is.
   @param suffix {String} The resulting url.
   @returns {a Url string}
   */
  qualifyUrl(suffix: string) {
    if (suffix && suffix.startsWith("http")) {
      return suffix;
    }
    let url = this.serviceName;
    // remove any trailing "/"
    if (stringEndsWith(url, "/")) {
      url = url.substr(0, url.length - 1);
    }
    // ensure that it ends with "/" + suffix
    suffix = "/" + suffix;
    if (!stringEndsWith(url, suffix)) {
      url = url + suffix;
    }
    return url;
  }

}
DataService.prototype._$typeName = "DataService";

function updateWithConfig(obj: DataService, dsConfig?: DataServiceConfig) {
  if (dsConfig) {
    assertConfig(dsConfig)
        .whereParam("serviceName").isOptional()
        .whereParam("adapterName").isString().isOptional()
        .whereParam("uriBuilderName").isString().isOptional()
        .whereParam("hasServerMetadata").isBoolean().isOptional()
        .whereParam("jsonResultsAdapter").isInstanceOf(JsonResultsAdapter).isOptional()
        .whereParam("useJsonp").isBoolean().isOptional()
        .applyAll(obj);
    obj.serviceName = obj.serviceName && DataService._normalizeServiceName(obj.serviceName);
    obj.adapterInstance = obj.adapterName ?  config.getAdapterInstance<DataServiceAdapter>("dataService", obj.adapterName) : undefined;
    obj.uriBuilder = obj.uriBuilderName ? config.getAdapterInstance<UriBuilderAdapter>("uriBuilder", obj.uriBuilderName) : undefined;
  }
  return obj;
}

/**
What a {@link JsonResultsAdapter}'s `visitNode` returns for one node of a query or save result,
telling Breeze how to treat it. Every property is optional; returning `{}` (or nothing) treats the
node as plain data.
*/
export interface NodeMeta {
  /** The type of entity or complex object this node is, or its name. When set, Breeze materializes the node as an entity of that type and merges it into the cache (unless the query is `noTracking`); a complex type is mapped without merging. For a top-level query result with no type, Breeze uses the query's result type. */
  entityType?: EntityType;
  /** An id for this node, such as a Json.NET `$id`, that other nodes can refer to with `nodeRefId`. */
  nodeId?: string;
  /** The `nodeId` of another node that this node stands for, such as a Json.NET `$ref`. Breeze returns the entity or object read from that node in its place. */
  nodeRefId?: string;
  /** Whether to skip this node. A skipped property is left off the object that holds it; a skipped top-level node is dropped from the results (or is `null` there, when the query includes deleted entities). */
  ignore?: boolean;
  /** Whether to keep the node exactly as the server sent it, without mapping its property names to the client's or visiting what it contains. Ignored for a top-level node that has an `entityType`, which is merged as an entity. */
  passThru?: boolean;
  /** Anything else about the node to keep. Breeze stores it on the entity's `entityAspect.extraMetadata`. */
  extraMetadata?: any;
  /** Use this object in place of the node that was visited. */
  node?: any;
}

/** Where a node passed to a {@link JsonResultsAdapter}'s `visitNode` sits in the result. */
export interface NodeContext {
  /** `"root"` for a top-level result, `"navProp"` or `"navPropItem"` for the value or an item of a navigation property, and `"anonProp"` or `"anonPropItem"` for the value or an item of a property of a plain (non-entity) object. */
  nodeType: string;
  /** For an `"anonProp"` or `"anonPropItem"` node, the client name of the property that holds it. */
  propertyName?: string;
  /** For a `"navProp"` or `"navPropItem"` node, the navigation property that holds it. */
  navigationProperty?: NavigationProperty;
}

/** Configuration info to be passed to the {@link JsonResultsAdapter} constructor */
export interface JsonResultsAdapterConfig {
  /** The name of this adapter.  This name is used to uniquely identify and locate this instance when an 'exported' JsonResultsAdapter is later imported. */
  name: string;
  /** A Function that is called once per query operation to extract the 'payload' from any json received over the wire. 
  This method has a default implementation which to simply return the "results" property from any json returned as a result of executing the query. 
  */
  extractResults?: Function;
  /** A function that is called once per save operation to extract the entities from any json received over the wire.  Must return an array.
  This method has a default implementation which simply returns the "entities" property from any json returned as a result of executing the save. */
  extractSaveResults?: Function;
  /** A function that is called once per save operation to extract the key mappings from any json received over the wire.  Must return an array.
  This method has a default implementation which simply returns the "keyMappings" property from any json returned as a result of executing the save. */
  extractKeyMappings?: (data: {}) => KeyMapping[];
  /** A function that is called once per save operation to extract any deleted keys from any json received over the wire.  Must return an array.
  This method has a default implementation which simply returns an empty array. */
  extractDeletedKeys?: (data: {}) => any[]; // TODO: refine
  /** A visitor method that will be called on each node of the returned payload. Required.
  Breeze always passes all three arguments. Returning nothing is the same as returning `{}`. */
  visitNode: (node: any, mappingContext: MappingContext, nodeContext: NodeContext) => NodeMeta | null | void;

}

/**
A JsonResultsAdapter instance is used to provide custom extraction and parsing logic on the json results returned by any web service.
This facility makes it possible for breeze to talk to virtually any web service and return objects that will be first class 'breeze' citizens.
*/
export class JsonResultsAdapter {
  /** @hidden @internal */
  declare _$typeName: string; // actually put on prototype.
  /** The name of this adapter.  This name is used to uniquely identify and locate this instance when an 'exported' JsonResultsAdapter is later imported. */
  name: string;
  /** A Function that is called once per query operation to extract the 'payload' from any json received over the wire. 
  This method has a default implementation which simply returns the "results" property from any json returned as a result of executing the query. */
  extractResults: Function; // TODO - refine
  /** A function that is called once per save operation to extract the entities from any json received over the wire.  Must return an array.
  This method has a default implementation which simply returns the "entities" property from any json returned as a result of executing the save. */
  extractSaveResults: Function;
    /** A function that is called once per save operation to extract the key mappings from any json received over the wire.  Must return an array.
  This method has a default implementation which simply returns the "keyMappings" property from any json returned as a result of executing the save. */
  extractKeyMappings:  (data: {}) => KeyMapping[];
  /** A function that is called once per save operation to extract any deleted keys from any json received over the wire.  Must return an array.
  This method has a default implementation which is to simply returns the "deletedKeys" property from any json returned as a result of executing the save. */
  extractDeletedKeys?: (data: {}) => any[]; // TODO: refine
  /** A visitor method that will be called on each node of the returned payload. */
  visitNode: Function;

  /**
  JsonResultsAdapter constructor

  @example
      //
      var jsonResultsAdapter = new JsonResultsAdapter({
          name: "test1e",
          extractResults: function(json) {
              return json.results;
          },
          visitNode: function(node, mappingContext, nodeContext) {
              var entityType = normalizeTypeName(node.$type);
              var propertyName = nodeContext.propertyName;
              var ignore = propertyName && propertyName.substr(0, 1) === "$";

              return {
                  entityType: entityType,
                  nodeId: node.$id,
                  nodeRefId: node.$ref,
                  ignore: ignore,
                  passThru: false // default
              };
          }
      });

      var dataService = new DataService( {
              serviceName: "breeze/foo",
              jsonResultsAdapter: jsonResultsAdapter
      });

      var entityManager = new EntityManager( {
          dataService: dataService
      });

  @param jsConfig - A configuration object.

  */
  constructor(jsConfig: JsonResultsAdapterConfig) {
    if (arguments.length !== 1) {
      throw new Error("The JsonResultsAdapter ctor should be called with a single argument that is a configuration object.");
    }

    assertConfig(jsConfig)
        .whereParam("name").isNonEmptyString()
        .whereParam("extractResults").isFunction().isOptional().withDefault(extractResultsDefault)
        .whereParam("extractSaveResults").isFunction().isOptional().withDefault(extractSaveResultsDefault)
        .whereParam("extractKeyMappings").isFunction().isOptional().withDefault(extractKeyMappingsDefault)
        .whereParam("extractDeletedKeys").isFunction().isOptional().withDefault(extractDeletedKeysDefault)
        .whereParam("visitNode").isFunction()
        .applyAll(this);
    config._storeObject(this, "JsonResultsAdapter", this.name);
  }

}
JsonResultsAdapter.prototype._$typeName = "JsonResultsAdapter";

function extractResultsDefault(data: any) {
  return data.results;
}

function extractSaveResultsDefault(data: any) {
  return data.entities || data.Entities || [];
}

function extractKeyMappingsDefault(data: any) {
  return data.keyMappings || data.KeyMappings || [];
}

function extractDeletedKeysDefault(data: any) {
  return data.deletedKeys || data.DeletedKeys || [];
}

