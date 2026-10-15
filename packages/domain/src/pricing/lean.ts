import { type PublishedConfig, publishConfigValue } from '../config/model.js';
import { parseMinor } from '../money.js';
import { type PricingInput, priceProposal } from './evaluate.js';

/** Authoring targets only; native currency/primary-Market qualification remains a separate admission requirement. */
export function validateLeanConfig(input: PublishedConfig): PublishedConfig {
  const config = publishConfigValue(input);
  if (!['EUR', 'USD', 'GBP'].includes(config.shopCurrency)) throw new Error('Lean shop currency is unsupported');
  for (const rule of config.pricingRules) {
    if (
      rule.role !== 'unit' ||
      rule.scope.kind !== 'step' ||
      !rule.scope.methodId ||
      rule.rate.kind !== 'fixed' ||
      rule.rate.amount.presentmentOverrides.length !== 0 ||
      rule.rate.amount.shopDecimal.startsWith('-') ||
      rule.methodUnitMultiplicity !== undefined
    )
      throw new Error('Lean prices require one final nonnegative method/placement/size surcharge');
    parseMinor(rule.rate.amount.shopDecimal, 2);
  }
  return config;
}

/** Constrain new inputs, then reuse the retained exact-money engine and original protocol economics. */
export function priceLeanProposal(input: PricingInput) {
  const configs = input.configs.map(validateLeanConfig);
  if (input.fx || configs.some((config) => config.shopCurrency !== input.currency.presentmentCurrency))
    throw new Error('Lean customization requires the shop currency without FX');
  for (const group of input.groups) {
    const config = configs.find(
      (config) =>
        config.shopId === group.shopId &&
        config.productId === group.productId &&
        config.revisionId === group.configRevisionId,
    );
    if (!config) throw new Error('Lean configuration unavailable');
    for (const choice of group.design.placements) {
      if (
        !config.pricingRules.some(
          (rule) =>
            rule.scope.kind === 'step' &&
            rule.scope.methodId === choice.methodId &&
            rule.scope.placementId === choice.placementId &&
            rule.scope.stepId === choice.stepId,
        )
      )
        throw new Error('Unavailable decoration price for the selected method, placement and size');
    }
  }
  return priceProposal(input);
}
