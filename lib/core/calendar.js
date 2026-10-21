/** Trading-date helpers. MVP uses weekdays; a real calendar is P1. */
const SHANGHAI = 'Asia/Shanghai';
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});
/** Trade date (Asia/Shanghai) of an ISO timestamp. */
export function tradeDateOf(iso) {
    const time = Date.parse(iso);
    if (Number.isNaN(time))
        return dateFormatter.format(new Date());
    return dateFormatter.format(new Date(time));
}
export function todayTradeDate(now = new Date()) {
    return dateFormatter.format(now);
}
function parseDate(date) {
    return new Date(`${date}T00:00:00+08:00`);
}
export function addDays(date, days) {
    const base = parseDate(date);
    base.setUTCDate(base.getUTCDate() + days);
    return dateFormatter.format(base);
}
/** Monday..Friday. Holidays are deliberately not modelled in the MVP. */
export function isTradeDay(date) {
    const day = parseDate(date).getUTCDay();
    return day >= 1 && day <= 5;
}
export function daysBetween(from, to) {
    const diff = parseDate(to).getTime() - parseDate(from).getTime();
    return Math.max(0, Math.round(diff / 86_400_000));
}
//# sourceMappingURL=calendar.js.map