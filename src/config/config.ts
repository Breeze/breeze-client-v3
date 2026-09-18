import type { AjaxAdapter, BreezeFetch, DataServiceAdapter, InterfaceRegistryConfig, ModelLibraryAdapter, UriBuilderAdapter } from './interface-registry.js';
import { core } from '../core/core.js';
import { assertParam, assertConfig } from '../core/assert-param.js';
import { BreezeEvent } from '../core/event.js';

/** @hidden */
export interface AdapterCtor<T extends BaseAdapter> { new (...args: any[]): T; }
/** @hidden */
export interface IDef<T extends BaseAdapter> { ctor: AdapterCtor<T>; defaultInstance?: T; }

/**
The names of the adapter interfaces, as passed to the 2.x-style methods on {@link BreezeConfig}
such as `registerAdapter` and `initializeAdapterInstance`. With {@link configureBreeze} you pass
the adapter classes instead and never need these names.
*/
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
    /** Creates a registry with no adapters in it. {@link config} holds the one Breeze uses;
    applications do not create their own. */
    constructor() { }
    /** The registered {@link AjaxAdapter}s, and the default one if any. Deprecated: Breeze 3 sends requests through `config.fetch` and needs no ajax adapter. */
    ajax = new InterfaceDef<AjaxAdapter>("ajax");
    /** The registered {@link ModelLibraryAdapter}s, and the default one. */
    modelLibrary = new InterfaceDef<ModelLibraryAdapter>("modelLibrary");
    /** The registered {@link DataServiceAdapter}s, and the default one. */
    dataService = new InterfaceDef<DataServiceAdapter>("dataService");
    /** The registered {@link UriBuilderAdapter}s, and the default one. */
    uriBuilder = new InterfaceDef<UriBuilderAdapter>("uriBuilder");
}

// The data service adapter resolves the ajax adapter when it initializes, so ajax has to
// come first. Same order as configureBreeze.
const initOrder: AdapterType[] = ['modelLibrary', 'uriBuilder', 'ajax', 'dataService'];

/**
What every Breeze adapter implements: the model library, data service, URI builder and
(deprecated) ajax adapters all extend this interface.
*/
export interface BaseAdapter {
    /** @hidden @internal */
    _$impl?: any;
    /**
    The name the adapter is registered under, such as `'webApi'` or `'backingStore'`. Names are
    matched without regard to case. `registerAdapter` reads it from a throwaway instance and throws
    if it is empty.
    */
    name: string;
    /**
    Called by Breeze each time the adapter is initialized: when it is first created, and again
    whenever it is initialized by name or registered again, for example by {@link configureBreeze}.
    Resolve anything the adapter depends on here, not in the constructor.
    */
    initialize(): void;
    /**
    Optional. Called each time any adapter is initialized after this one first was, with
    `{ interfaceName, instance, isDefault }`, so that this adapter can pick up a new dependency. The data service adapters use
    it to re-resolve their ajax adapter when a new default ajax adapter is initialized.
    */
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

/**
Breeze's global configuration: the adapter registry, the `fetch` transport, and registries Breeze
uses to find functions and objects by name when it deserializes metadata. The single instance is
{@link config}.

To configure Breeze, use {@link configureBreeze}. The adapter methods here (`registerAdapter`,
`initializeAdapterInstance`, `getAdapterInstance` and the rest) are the 2.x API. They still
work, and adapters' own static `register()` methods use them, but an application does not
normally need to call them.
*/
export class BreezeConfig {
    /**
    Functions registered by name with {@link BreezeConfig.registerFunction}. Breeze looks up
    validator factories here, under `"Validator." + name`, when it imports metadata. Applications do
    not normally need it; use {@link Validator.register} and {@link Validator.registerFactory}.
    */
    functionRegistry: Record<string, Function> = {};
    /**
    Constructors registered by name with {@link BreezeConfig.registerType}. Nothing in Breeze 3
    reads it; applications do not normally need it.
    */
    typeRegistry: Record<string, Function> = {};
    /**
    Named instances Breeze can find again by name, keyed `"<TypeName>.<name>"`: every
    {@link JsonResultsAdapter}, {@link NamingConvention} and {@link LocalQueryComparisonOptions}
    registers itself here when created. Breeze uses it to resolve the names in exported metadata and
    exported entities. Applications do not normally need it.
    */
    objectRegistry: Record<string, any> = {};
    /**
    Published each time an adapter is initialized, with the interface name, the adapter instance
    and whether it became the default for its interface. Breeze uses it to let adapters that depend
    on each other recompose (see {@link BaseAdapter.checkForRecomposition}); applications do not
    normally need it.
    */
    interfaceInitialized: BreezeEvent<{
        /** The interface the adapter implements: `"ajax"`, `"dataService"`, `"modelLibrary"` or `"uriBuilder"`. */
        interfaceName: string,
        /** The adapter that was initialized. */
        instance: BaseAdapter,
        /** Whether it became the default adapter for its interface. */
        isDefault: boolean
    }>;

    /**
     * Adapter instances already subscribed to `interfaceInitialized` for recomposition, so that
     * re-initializing one does not subscribe it twice. Weak because the entry is only ever looked
     * up for an instance in hand, and one outliving its adapter would be its own small leak.
     * @hidden @internal
     */
    private _recomposers = new WeakSet<BaseAdapter>();

    /**
    The indentation Breeze passes to `JSON.stringify` when it serializes exported entities
    (`EntityManager.exportEntities`) and exported metadata (`MetadataStore.exportMetadata`).
    The default, `''`, produces compact JSON; set it to, say, `'  '` for readable output.
    */
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
    */
    declare initializeAdapterInstances: (irConfig: InterfaceRegistryConfig) => void;

    /** Creates a configuration with nothing registered. Breeze creates the one instance there is,
    {@link config}; applications do not create their own. */
    constructor() {
        this.interfaceInitialized = new BreezeEvent("interfaceInitialized", this);
    }

    /**
    Method use to register implementations of standard breeze interfaces.  Calls to this method are usually
    made as the last step within an adapter implementation.
    @param interfaceName {String} - one of the following interface names: "ajax", "dataService", "modelLibrary", "uriBuilder"
    @param adapterCtor {Function} - an ctor function that returns an instance of the specified interface.

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
    */
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
    */
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

    /**
    Registers a constructor under a type name: stamps the name on its prototype as `_$typeName` and
    adds it to {@link BreezeConfig.typeRegistry}. Breeze registers `KeyGenerator` this way;
    applications do not normally need it.
    @param ctor - The constructor to register.
    @param typeName - The name to register it under.
    */
    registerType(ctor: Function, typeName: string) {
        assertParam(ctor, "ctor").isFunction().check();
        assertParam(typeName, "typeName").isString().check();
        if (ctor.prototype) {
            ctor.prototype._$typeName = typeName;
        }
        this.typeRegistry[typeName] = ctor;
    }

    /**
    Returns the function registered under the given name with {@link BreezeConfig.registerFunction},
    or `undefined` if there is none. Validators are registered as `"Validator." + name`, so
    `config.getRegisteredFunction('Validator.maxLength')` returns the `maxLength` factory.
    @param fnName - The name the function was registered under.
    */
    getRegisteredFunction(fnName: string) {
        return this.functionRegistry[fnName];
    }

    /**
    Returns the registry entry for one adapter interface, which holds its registered adapters and
    its default instance. The name is matched without regard to case.
    Used by the adapter registration methods; applications do not normally need it.
    @param interfaceName - `'ajax'`, `'dataService'`, `'modelLibrary'` or `'uriBuilder'`.
    @throws if there is no interface with that name.
    */
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

        // Once per instance, not once per call. An adapter instance is cached on its impl, so
        // re-initializing the same one - which configureBreeze does, and a test suite does over
        // and over - used to add a second subscription for the same object: the subscriber list
        // grew without bound, each duplicate holding the adapter, and checkForRecomposition ran
        // once per duplicate on every later initialization. See the retention tier.
        if (instance.checkForRecomposition != null && !this._recomposers.has(instance)) {
            this._recomposers.add(instance);
            // now register for own dependencies.
            this.interfaceInitialized.subscribe((interfaceInitializedArgs) => {
                // The `!` is needed because narrowing does not reach inside the callback:
                // `instance` is a mutable binding, so TypeScript has to assume the property
                // could have been cleared before the subscription fires. Reading it off
                // `instance` here rather than capturing it in a const is deliberate - that is
                // what gives the adapter its `this`.
                instance.checkForRecomposition!(interfaceInitializedArgs);
            });
        }

        return instance;
    }

}

/**
The global {@link BreezeConfig}, used by every `EntityManager`, `MetadataStore` and `DataService`.

To configure Breeze, use {@link configureBreeze}, which sets this object's adapters and `fetch`.
The 2.x calls on it, such as `config.registerAdapter(...)` and
`config.initializeAdapterInstance(...)`, still work and are not scheduled for removal.
*/
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



