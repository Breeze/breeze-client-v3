# Custom metadata

You can attach your own information to types and properties, such as UI hints,
descriptions or formatting rules. It then lives with the rest of the model instead of in
a separate registry.

Every `EntityType`, `ComplexType`, `DataProperty` and `NavigationProperty` has a `custom`
property for this. It can hold any value that survives `JSON.stringify` and `JSON.parse`.
Breeze ignores it, except that `exportMetadata()` writes it and `importMetadata()` reads
it back.

Only use `custom`. Other properties you tack onto a metadata object are lost on export.

## Adding it when you define a type

The configuration objects and the constructors all accept `custom`:

```ts
store.addEntityType({
  shortName: 'Supplier',
  namespace: 'Northwind.Models',
  custom: { style: 'bold' },
  dataProperties: {
    supplierID:  { dataType: DataType.Int32, isPartOfKey: true, isNullable: false },
    companyName: { maxLength: 40, custom: { uiHint: 'big' } },
  },
});

const idProp = new DataProperty({
  name: 'id',
  dataType: DataType.Int32,
  isPartOfKey: true,
  isNullable: false,
  custom: { hidden: true },
});
```

## Adding it to metadata from the server

When the server supplies the metadata, merge your custom values in after it arrives. Pass
a cut-down metadata object to `importMetadata` with the second argument, `allowMerge`, set
to `true`:

```ts
await em.fetchMetadata();

const store = em.metadataStore;
const { namespace } = store.getAsEntityType('Customer')!;

store.importMetadata({
  structuralTypes: [{
    shortName: 'Customer',
    namespace,
    custom: { description: 'A customer' },
    dataProperties: [
      { name: 'companyName', custom: { uiHint: 'big' } },
      { nameOnServer: 'ContactName', custom: { uiHint: 'normal' } },
    ],
    navigationProperties: [
      { name: 'orders', custom: { description: 'Orders placed by this customer' } },
    ],
  }],
}, true);
```

- A type is matched by `shortName` and `namespace`, and must already be in the store.
- A property is matched by `name`, or by `nameOnServer` translated with the store's
  naming convention. A property that isn't found throws `unable to locate property`.
- Only `custom` is merged. Anything else in the object is ignored, so you can't use this
  to change a data type or add a property.

::: warning allowMerge is required
Without `allowMerge`, `importMetadata` skips any type already in the store, silently. Your
custom values are dropped and no error is raised.
:::

You can also keep the custom metadata in its own JSON file and import it the same way.

## Setting it at runtime

`setProperties` accepts `custom` on all four classes:

```ts
const customerType = store.getAsEntityType('Customer')!;
customerType.setProperties({ custom: { description: 'A customer' } });
customerType.getDataProperty('companyName').setProperties({ custom: { uiHint: 'big' } });
```

`DataProperty.setProperties` and `NavigationProperty.setProperties` also accept
`displayName`. If what you want is a label, use `displayName`: Breeze uses it in
validation messages.

## Reading it

```ts
const customerType = em.metadataStore.getAsEntityType('Customer')!;

customerType.custom?.description;                      // 'A customer'
customerType.getProperty('companyName')?.custom?.uiHint;   // 'big'
```

`custom` is `undefined` wherever you haven't set it.

## Export and import

`exportMetadata()` includes every `custom` value, and importing the result into a new
store restores them:

```ts
const json = em.metadataStore.exportMetadata();
const copy = MetadataStore.importMetadata(json);

copy.getAsEntityType('Customer')!.custom?.description;   // 'A customer'
```

See [Export and import](/guide/export-import) and [Metadata in depth](/metadata/details).
