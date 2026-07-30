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
for (const connector of connectors) {
  assert.equal(
    /\b\d+(\.\d+)?\s*%/.test(connector.provider_policy_risk ?? ''),
    false,
    `${connector.name} must not fabricate a provider-policy risk percentage`,
  );
}

console.log('test-pricing-manifest: pricing model and capability truth are frozen.');
