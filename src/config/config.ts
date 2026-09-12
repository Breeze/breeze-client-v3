import type { AjaxAdapter, BreezeFetch, DataServiceAdapter, InterfaceRegistryConfig, ModelLibraryAdapter, UriBuilderAdapter } from './interface-registry.js';
import { core } from '../core/core.js';
import { assertParam, assertConfig } from '../core/assert-param.js';
import { BreezeEvent } from '../core/event.js';

/** @hidden */
export interface AdapterCtor<T extends BaseAdapter> { new (...args: any[]): T; }
/** @hidden */
export interface IDef<T extends BaseAdapter> { ctor: AdapterCtor<T>; defaultInstance?: T; }

export type AdapterType = 'dataService'|'modelLibrary'|'ajax'|'uriBuilder';

export class InterfaceDef<T extends BaseAdapter> {

    name: string;
    defaultInstance?: T;
    /** @hidden @internal */
    _implMap: Map<string, IDef<T>>;

    constructor(name: string) {
        this.name = name;
        this.defaultInstance = undefined;
        this._implMap = new Map();
    }

    /** Define an implementation of the given adaptername */
    registerCtor(adapterName: string, ctor: AdapterCtor<T>): void {
        this._implMap.set(adapterName.toLowerCase(), { ctor: ctor, defaultInstance: undefined });
    }

    /** Return the definition for the given adapterName */
    getImpl(adapterName: string): IDef<T> {
        return this._implMap.get(adapterName.toLowerCase()) as IDef<T>;
    }

    /** Return the first implementation for this InterfaceDef */
    getFirstImpl(): IDef<T> {
        // Map preserves insertion order, so 'first' is well defined here.
        const first = this._implMap.values().next();
        return first.done ? null as any : first.value;
    }

    getDefaultInstance() {
        return this.defaultInstance as T;
    }
}

/** Registers adapters used by Breeze */
export class InterfaceRegistry {
    ajax = new InterfaceDef<AjaxAdapter>("ajax");
    modelLibrary = new InterfaceDef<ModelLibraryAdapter>("modelLibrary");
    dataService = new InterfaceDef<DataServiceAdapter>("dataService");
    uriBuilder = new InterfaceDef<UriBuilderAdapter>("uriBuilder");
}

// The data service adapter resolves the ajax adapter when it initializes, so ajax has to
// come first. Same order as configureBreeze.
const initOrder: AdapterType[] = ['modelLibrary', 'uriBuilder', 'ajax', 'dataService'];

export interface BaseAdapter {
    /** @hidden @internal */
    _$impl?: any;
    name: string;
    initialize(): void;
    checkForRecomposition?: (context: any) => void;
}

/**
An adapter Breeze falls back to for an interface when nothing has been registered for it.
@hidden
*/
export interface DefaultAdapter {
    ctor: AdapterCtor<any>;
    /** Use only when asked for by name, never as the unnamed default. */
    namedOnly?: boolean;
}

const defaultAdapters: Partial<Record<AdapterType, DefaultAdapter>> = {};

/**
Sets the adapters Breeze falls back to when none has been registered for an interface.
Called once, by default-adapters.ts; applies to every BreezeConfig.
@hidden @internal
*/
export function setDefaultAdapters(defaults: Partial<Record<AdapterType, DefaultAdapter>>) {
    Object.assign(defaultAdapters, defaults);
}

export class BreezeConfig {
    functionRegistry: Record<string, Function> = {};
    typeRegistry: Record<string, Function> = {};
    objectRegistry: Record<string, any> = {};
    interfaceInitialized: BreezeEvent<{ interfaceName: string, instance: BaseAdapter, isDefault: boolean }>;

    stringifyPad = '';
    /**
     * The function Breeze makes HTTP requests with, unless a (deprecated) ajax adapter is
     * registered. Set it with `configureBreeze({ fetch })`. When unset, `globalThis.fetch`.
     */
    fetch?: BreezeFetch;
    /** @hidden @internal */
    _interfaceRegistry: any;  // set below, on the global config. Untyped: getInterfaceDef looks interfaces up by name.
    /** @hidden @internal The adapter interfaces, strongly typed. Set below, on the global config. */
    declare interfaceRegistry: InterfaceRegistry;
    /**
    Initializes a collection of adapter implementations and makes each one the default for its corresponding interface.
    @deprecated Use `configureBreeze({ ... })` instead. Still works; not scheduled for removal.
    @param irConfig - The name of a previously registered adapter for each interface to initialize,
    e.g. `{ ajax: 'fetch', dataService: 'webApi' }`. Interfaces not named are left as they are.
    @hidden @internal
    **/
    declare initializeAdapterInstances: (irConfig: InterfaceRegistryConfig) => void;

    constructor() {
        this.interfaceInitialized = new BreezeEvent("interfaceInitialized", this);
    }

    /**
    Method use to register implementations of standard breeze interfaces.  Calls to this method are usually
    made as the last step within an adapter implementation.
    @param interfaceName {String} - one of the following interface names: "ajax", "dataService", "modelLibrary", "uriBuilder"
    @param adapterCtor {Function} - an ctor function that returns an instance of the specified interface.
    **/
    /**
    @deprecated For configuring an application, use `configureBreeze({ ajax: MyAdapter, ... })`
    instead: the adapter classes are passed directly, so a misspelled name is a compile error
    rather than a runtime one. An adapter's own static `register()` still calls this - that is
    how an adapter registers itself, and is not deprecated. Not scheduled for removal.
    */
    registerAdapter<T extends BaseAdapter>(interfaceName: AdapterType, adapterCtor: AdapterCtor<T>) {
        assertParam(interfaceName, "interfaceName").isNonEmptyString().check();
        assertParam(adapterCtor, "adapterCtor").isFunction().check();
        // this impl will be thrown away after the name is retrieved.
        let impl = new adapterCtor();
        let implName = impl.name;
        if (!implName) {
            throw new Error("Unable to locate a 'name' property on the constructor passed into the 'registerAdapter' call.");
        }
        let idef = this.getInterfaceDef(interfaceName);
        idef.registerCtor(implName, adapterCtor);
    }

    /**
    Returns the ctor function used to implement a specific interface with a specific adapter name.
    @param interfaceName {String} One of the following interface names: "ajax", "dataService", "modelLibrary", "uriBuilder"
    @param [adapterName] {String} The name of any previously registered adapter. If this parameter is omitted then
    this method returns the "default" adapter for this interface. If there is no default adapter, then a null is returned.
    @returns {Function|null} Returns either a ctor function or null.
    **/
    getAdapter(interfaceName: AdapterType, adapterName: string) {
        let idef = this.getInterfaceDef(interfaceName);
        if (adapterName) {
            let impl = idef.getImpl(adapterName);
            return impl ? impl.ctor : null;
        } else {
            return idef.defaultInstance ? idef.defaultInstance._$impl.ctor : null;
        }
    }

    /**
    Initializes a single adapter implementation. Initialization means either newing a instance of the
    specified interface and then calling "initialize" on it or simply calling "initialize" on the instance
    if it already exists.
    @param interfaceName {String} The name of the interface to which the adapter to initialize belongs.
    @param adapterName {String} - The name of a previously registered adapter to initialize.
    @param [isDefault=true] {Boolean} - Whether to make this the default "adapter" for this interface.
    @returns {an instance of the specified adapter}
    **/
    /**
    @deprecated For configuring an application, use `configureBreeze({ ajax: MyAdapter, ... })`
    instead: the adapter classes are passed directly, so a misspelled name is a compile error
    rather than a runtime one. An adapter's own static `register()` still calls this - that is
    how an adapter registers itself, and is not deprecated. Not scheduled for removal.
    */
    initializeAdapterInstance(interfaceName: AdapterType, adapterName: string, isDefault: boolean = true) {
        isDefault = isDefault === undefined ? true : isDefault;
        assertParam(interfaceName, "interfaceName").isNonEmptyString().check();
        assertParam(adapterName, "adapterName").isNonEmptyString().check();
        assertParam(isDefault, "isDefault").isBoolean().check();

        let idef = this.getInterfaceDef(interfaceName);
        let impl = idef.getImpl(adapterName) || this._registerDefaultAdapter(idef, interfaceName, adapterName);
        if (!impl) {
            throw new Error("Unregistered adapter.  Interface: " + interfaceName + " AdapterName: " + adapterName);
        }

        return this._initializeAdapterInstanceCore(idef, impl, isDefault);
    }

    /**
    Returns the adapter instance corresponding to the specified interface and adapter names.
    @param interfaceName {String} The name of the interface.
    @param [adapterName] {String} - The name of a previously registered adapter.  If this parameter is
    omitted then the default implementation of the specified interface is returned. If there is
    no defaultInstance of this interface, then the first registered instance of this interface is returned.
    @returns {an instance of the specified adapter}
    **/
    getAdapterInstance<T extends BaseAdapter>(interfaceName: AdapterType, adapterName?: string) {
        let idef = this.getInterfaceDef<T>(interfaceName);
        let impl: IDef<T>;

        let isDefault = adapterName == null || adapterName === "";
        if (isDefault) {
            if (idef.defaultInstance) return idef.defaultInstance;
            impl = idef.getFirstImpl();
        } else {
            impl = idef.getImpl(adapterName!);
        }
        if (!impl) impl = this._registerDefaultAdapter(idef, interfaceName, isDefault ? undefined : adapterName)!;
        if (!impl) return undefined;
        if (impl.defaultInstance) {
            return impl.defaultInstance;
        } else {
            return this._initializeAdapterInstanceCore(idef, impl, isDefault);
        }
    }

    /** this is needed for reflection purposes when deserializing an object that needs a fn or ctor.
        Used to register validators. */
    registerFunction(fn: Function, fnName: string) {
        assertParam(fn, "fn").isFunction().check();
        assertParam(fnName, "fnName").isString().check();
        if (fn.prototype) {
            fn.prototype._$fnName = fnName;
        }
        this.functionRegistry[fnName] = fn;
    }

    registerType(ctor: Function, typeName: string) {
        assertParam(ctor, "ctor").isFunction().check();
        assertParam(typeName, "typeName").isString().check();
        if (ctor.prototype) {
            ctor.prototype._$typeName = typeName;
        }
        this.typeRegistry[typeName] = ctor;
    }

    getRegisteredFunction(fnName: string) {
        return this.functionRegistry[fnName];
    }

    getInterfaceDef<T extends BaseAdapter>(interfaceName: string) {
        let lcName = interfaceName.toLowerCase();
        // source may be null
        let kv = core.objectFirst(this._interfaceRegistry || {}, function (k, v) {
            return k.toLowerCase() === lcName;
        });
        if (!kv) {
            throw new Error("Unknown interface name: " + interfaceName);
        }
        return <InterfaceDef<T>>kv.value;
    }

    /** @deprecated @internal no-op kept for backward compatibility */
    setQ(q: any) {
        console && console.warn("setQ does nothing; ES6 Promise support is required - use a shim if necessary.");
    }

    /** @hidden @internal */
    _storeObject(obj: Object, type: string | Function, name: string) {
        // uncomment this if we make this public.
        //assertParam(obj, "obj").isObject().check();
        //assertParam(name, "objName").isString().check();
        let key = (typeof (type) === "string" ? type : type.prototype._$typeName) + "." + name;
        this.objectRegistry[key] = obj;
    }

    /** @hidden @internal */
    _fetchObject(type: string | Function, name: string) {
        if (!name) return undefined;
        let key = (typeof (type) === "string" ? type : type.prototype._$typeName) + "." + name;
        let result = this.objectRegistry[key];
        if (!result) {
            throw new Error("Unable to locate a registered object by the name: " + key);
        }
        return result;
    }

    /**
    Registers the default adapter for an interface that has none, so that Breeze works with no
    configuration at all (see default-adapters.ts). It runs only when the interface is first
    asked for and nothing has been registered for it, so importing Breeze still registers
    nothing, and anything an application registers wins. A named lookup falls back only when
    the name is the default adapter's own.
    @hidden @internal
    */
    _registerDefaultAdapter<T extends BaseAdapter>(idef: InterfaceDef<T>, interfaceName: AdapterType, adapterName?: string): IDef<T> | undefined {
        const fallback = defaultAdapters[interfaceName];
        if (!fallback) return undefined;
        if (!adapterName && fallback.namedOnly) return undefined;
        const name: string = new fallback.ctor().name;
        if (adapterName && adapterName.toLowerCase() !== name.toLowerCase()) return undefined;
        this.registerAdapter(interfaceName, fallback.ctor);
        return idef.getImpl(name);
    }

    /** @hidden @internal */
    _initializeAdapterInstanceCore<T extends BaseAdapter>(interfaceDef: InterfaceDef<T>, impl: IDef<T>, isDefault: boolean) {
        let instance: T;
        let inst = impl.defaultInstance;
        if (!inst) {
            instance = new (impl.ctor)();
            impl.defaultInstance = instance;
            instance._$impl = impl;
        } else {
            instance = inst;
        }

        instance.initialize();

        if (isDefault) {
            // next line needs to occur before any recomposition
            interfaceDef.defaultInstance = instance;
        }

        // recomposition of other impls will occur here.
        this.interfaceInitialized.publish({ interfaceName: interfaceDef.name, instance: instance, isDefault: isDefault });

        if (instance.checkForRecomposition != null) {
            // now register for own dependencies.
            this.interfaceInitialized.subscribe((interfaceInitializedArgs) => {
                // TODO: why '!'s needed here for typescript to compile correctly???
                instance.checkForRecomposition!(interfaceInitializedArgs);
            });
        }

        return instance;
    }

}

export const config = new BreezeConfig();

// The adapter interfaces. They are set here rather than in interface-registry.ts because every
// adapter lookup needs them, and under "sideEffects": false a bundler drops a module that nothing
// uses a value from - such as interface-registry.ts, which only the barrel imports. See
// CHANGES-DEV.md.
config.interfaceRegistry = new InterfaceRegistry();
config._interfaceRegistry = config.interfaceRegistry;
config.interfaceRegistry.modelLibrary.getDefaultInstance = function() {
    // Falls back to the default model library (backingStore) when none is registered.
    const instance = this.defaultInstance || config.getAdapterInstance<ModelLibraryAdapter>("modelLibrary");
    if (!instance) {
        throw new Error("Unable to locate the default implementation of the '" + this.name +
            "' interface. Register one with configureBreeze({ modelLibrary: ... }).");
    }
    return instance;
};

/** @deprecated Use `configureBreeze({ ... })` instead. Still works; not scheduled for removal. */
config.initializeAdapterInstances = function (irConfig: InterfaceRegistryConfig) {
    // Validate only - rejects unknown keys. This used to apply irConfig onto the global
    // config and then walk every property of *config*, passing things like functionRegistry
    // to initializeAdapterInstance as adapter names, so it always threw. Nothing tested it.
    assertConfig(irConfig)
        .whereParam("dataService").isOptional()
        .whereParam("modelLibrary").isOptional()
        .whereParam("ajax").isOptional()
        .whereParam("uriBuilder").isOptional()
        .applyAll(irConfig, true);
    initOrder.forEach(name => {
        const adapterName = irConfig[name];
        if (adapterName) this.initializeAdapterInstance(name, adapterName, true);
    });
};

// legacy
(core as any).config = config;



