// @ts-check
import { DiscountApplicationStrategy } from "../generated/api";

/**
 * @typedef {import("../generated/api").RunInput} RunInput
 * @typedef {import("../generated/api").FunctionRunResult} FunctionRunResult
 */

/** Valor por defecto sin descuentos */
const EMPTY_DISCOUNT = {
  discountApplicationStrategy: DiscountApplicationStrategy.First,
  discounts: [],
};

/**
 * @param {RunInput} input
 * @returns {FunctionRunResult}
 */
export function run(input) {
  const cart = input.cart;
  const {giftVariantId, threshold } = input.discountNode
  
  var free_gift_variant_id = parseInt(giftVariantId.value);
  var free_gift_threshold = parseFloat(threshold.value);
  var free_gift_enabled = true;
  

    
  const isEnabled = free_gift_enabled;

  if (!isEnabled || isNaN(free_gift_threshold) || !free_gift_variant_id) {
    return EMPTY_DISCOUNT;
  }

  const giftGid = `gid://shopify/ProductVariant/${free_gift_variant_id}`;
  const subtotal = parseFloat(cart.cost.subtotalAmount.amount);

  if (subtotal < free_gift_threshold) {
    return EMPTY_DISCOUNT;
  }

  // Buscar la primera línea del carrito que contenga la variante de regalo
  const giftLine = cart.lines.find(line => line.merchandise?.id === giftGid);

  if (!giftLine) {
    return EMPTY_DISCOUNT;
  }

  // Aplicar descuento del 100% a una unidad de la línea encontrada
  return {
    discountApplicationStrategy: DiscountApplicationStrategy.First,
    discounts: [
      {
        targets: [
          {
            cartLine: {
              id: giftLine.id,
              quantity: 1,
            },
          },
        ],
        value: {
          percentage: {
            value: 100.0,
          },
        },
        message: "FREE GIFT",
      },
    ],
  };
}
