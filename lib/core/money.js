/** Money helpers. Amounts are integer cents; prices are yuan rounded to 0.01. */
export function roundPrice(price) {
    if (!Number.isFinite(price))
        return 0;
    return Math.round(price * 100) / 100;
}
export function amountCents(price, qty) {
    return Math.round(roundPrice(price) * qty * 100);
}
//# sourceMappingURL=money.js.map