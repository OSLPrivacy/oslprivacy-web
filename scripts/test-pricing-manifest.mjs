import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pricing = JSON.parse(await readFile('data/pricing.json', 'utf8'));

// Mirrors the central h1 accept command, then proves the manifest is not just
// passing by shape.
assert.ok(pricing.model, 'pricing manifest must expose model');
assert.ok(pricing.capability_registry, 'pricing manifest must expose capability_registry');
assert.ok(pricing.connector_matrix, 'pricing manifest must expose connector_matrix');

assert.deepEqual(
  pricing.model.truth_contract?.accept_requires_top_level,
  ['model', 'capability_registry', 'connector_matrix'],
  'model truth contract must name the h1 accept roots',
);

assert.equal(pricing.model.no_stored_payment_data, true);
assert.equal(pricing.model.no_auto_renewal, true);
assert.equal(pricing.model.no_account_required, true);
assert.equal(pricing.model.period_starts_on_redemption, false);
assert.equal(pricing.model.intended_period_starts_on_redemption, true);
assert.equal(
  pricing.model.truth_contract.checkout_state,
  'paused_until_redemption_records_and_automatic_one_month_expiry_exist',
);
assert.match(
  pricing.model.truth_contract.absence_rule,
  /never means permission/,
  'absence of authority must fail closed',
);
assert.ok(
  pricing.model.truth_contract.must_not_publish_until_implemented.includes(
    'Your month starts when you enter the code.',
  ),
  'redemption-start timing must remain unpublished until implemented',
);

const registryById = new Map(pricing.capability_registry.map((entry) => [entry.id, entry]));
for (const capabilityId of ['image-send', 'file-send', 'view-once', 'burn', 'autoscrub']) {
  assert.equal(
    registryById.get(capabilityId)?.sellable,
    false,
    `${capabilityId} must not be sold from the pricing model while unfinished`,
  );
}

const checkoutPaused = Object.values(pricing.payment_methods)
  .every((method) => method.status === 'Paused' && method.stores_payment_method === false);
assert.equal(checkoutPaused, true, 'all purchase methods stay paused and store no payment method');

const connectors = pricing.connector_matrix.connectors ?? [];
assert.ok(connectors.length > 0, 'connector matrix must name at least one connector');
assert.match(
  pricing.connector_matrix.version,
  /^\d{4}-\d{2}-\d{2}$/,
  'connector matrix version must be an exact review date',
);
const connectorSources = pricing.connector_matrix.sources ?? [];
assert.ok(connectorSources.length > 0, 'connector matrix must carry source metadata');
const connectorSourceIds = new Set(connectorSources.map((source) => source.id));
for (const connector of connectors) {
  assert.equal(
    connector.verified_on,
    pricing.connector_matrix.version,
    `${connector.name} review date must match the matrix version`,
  );
  assert.ok(
    Array.isArray(connector.source_ids) && connector.source_ids.length > 0,
    `${connector.name} must cite at least one current connector source`,
  );
  for (const sourceId of connector.source_ids) {
    assert.ok(
      connectorSourceIds.has(sourceId),
      `${connector.name} cites unknown source ${sourceId}`,
    );
  }
  assert.equal(
    /\b\d+(\.\d+)?\s*%/.test(connector.provider_policy_risk ?? ''),
    false,
    `${connector.name} must not fabricate a provider-policy risk percentage`,
  );
  assert.notEqual(
    connector.provider_policy_risk?.trim(),
    '',
    `${connector.name} must fail closed with an explicit provider-policy risk note`,
  );
}

for (const source of connectorSources) {
  assert.match(source.id, /^[a-z0-9-]+$/, 'connector source ids must be stable tokens');
  assert.match(source.url, /^https:\/\//, `${source.id} must use an HTTPS source URL`);
  assert.match(
    source.accessed_on,
    /^\d{4}-\d{2}-\d{2}$/,
    `${source.id} must carry an exact access date`,
  );
  assert.ok(source.publisher, `${source.id} must name the source publisher`);
  assert.ok(source.source_type, `${source.id} must name the source type`);
  assert.ok(source.title, `${source.id} must name the source title`);
}

console.log('test-pricing-manifest: pricing model and capability truth are frozen.');
