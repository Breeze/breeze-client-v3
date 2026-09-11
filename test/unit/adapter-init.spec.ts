import { config } from '../../src/breeze';
import type { AjaxConfig } from '../../src/breeze';
import { builtinAjax } from '../../src/http';
import { DataServiceWebApiAdapter } from '../../src/adapter-data-service-webapi';

// Adapter initialization publishes interfaceInitialized, saying whether the adapter became
// the default. A data service adapter re-resolves its ajax adapter only for a new default.
// This file registers ajax adapters, so it is kept apart from the specs that rely on fetch.

/** An ajax adapter that sends nothing; only its identity matters here. */
class NullAjax {
  static adapterName = 'nullAjax';
  name = NullAjax.adapterName;
  initialize() { }
  ajax(config: AjaxConfig) { }
}

class OtherAjax extends NullAjax {
  static adapterName = 'otherAjax';
  name = OtherAjax.adapterName;
}

const dsAdapter = DataServiceWebApiAdapter.register();

test('interfaceInitialized reports whether the adapter became the default', () => {
  const seen: { interfaceName: string, isDefault: boolean }[] = [];
  const token = config.interfaceInitialized.subscribe(args => {
    seen.push({ interfaceName: args.interfaceName, isDefault: args.isDefault });
  });
  try {
    config.registerAdapter('ajax', NullAjax);
    config.initializeAdapterInstance('ajax', NullAjax.adapterName, false);
    config.registerAdapter('ajax', OtherAjax);
    config.initializeAdapterInstance('ajax', OtherAjax.adapterName, true);
  } finally {
    config.interfaceInitialized.unsubscribe(token);
  }
  expect(seen).toEqual([
    { interfaceName: 'ajax', isDefault: false },
    { interfaceName: 'ajax', isDefault: true },
  ]);
});

test('a data service adapter takes up a new default ajax adapter, but not a non-default one', () => {
  // The previous test made OtherAjax the default, and the data service adapter took it up.
  expect(dsAdapter.ajaxImpl).toBeInstanceOf(OtherAjax);
  dsAdapter.ajaxImpl = builtinAjax;

  config.initializeAdapterInstance('ajax', NullAjax.adapterName, false);
  expect(dsAdapter.ajaxImpl).toBe(builtinAjax);

  config.initializeAdapterInstance('ajax', NullAjax.adapterName, true);
  expect(dsAdapter.ajaxImpl).toBeInstanceOf(NullAjax);
  expect(dsAdapter.ajaxImpl).not.toBeInstanceOf(OtherAjax);
});
