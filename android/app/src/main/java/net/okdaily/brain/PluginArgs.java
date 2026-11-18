package net.okdaily.brain;

/**
 * Reads numbers that JavaScript sent over the Capacitor bridge.
 *
 * <p>The bridge parses the call's JSON with org.json, which stores every whole number that fits in
 * an int as an {@link Integer}. {@code PluginCall.getLong} only accepts a {@link Long}, so it
 * returns null (or the default) for a value like 2048. Always read sizes through this class.
 */
final class PluginArgs {
    private PluginArgs() {}

    /** A whole, positive number of any boxed type, or -1 when the value is missing or invalid. */
    static long positiveWholeNumber(Object value) {
        if (!(value instanceof Number)) {
            return -1L;
        }

        Number number = (Number) value;
        double asDouble = number.doubleValue();

        if (
                Double.isNaN(asDouble)
                        || Double.isInfinite(asDouble)
                        || asDouble <= 0d
                        || asDouble != Math.floor(asDouble)
                        || asDouble > (double) Long.MAX_VALUE
        ) {
            return -1L;
        }

        return number.longValue();
    }
}
