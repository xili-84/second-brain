package net.okdaily.brain;

import static org.junit.Assert.assertEquals;

import static org.junit.Assert.assertNull;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import org.json.JSONObject;
import org.junit.Test;

public class PluginArgsTest {
    /** The 1.6.0 bug: the bridge's JSON gives Integer for small numbers and getLong() ignored it. */
    @Test
    public void readsSizesTheBridgeParsedAsInteger() throws Exception {
        JSONObject data = new JSONObject("{\"expectedSize\":2048,\"size\":3499424}");

        assertEquals(Integer.class, data.opt("expectedSize").getClass());
        assertEquals(2048L, PluginArgs.positiveWholeNumber(data.opt("expectedSize")));
        assertEquals(3_499_424L, PluginArgs.positiveWholeNumber(data.opt("size")));
    }

    /** Reproduces the root cause with Capacitor's own PluginCall. */
    @Test
    public void capacitorGetLongDropsIntegerSizes() throws Exception {
        PluginCall call = new PluginCall(null, "FileSaver", "1", "saveFile", new JSObject("{\"expectedSize\":2048}"));

        assertNull(call.getLong("expectedSize"));
        assertEquals(2048L, PluginArgs.positiveWholeNumber(call.getData().opt("expectedSize")));
    }

    @Test
    public void readsLargeAndWholeDoubleValues() throws Exception {
        JSONObject data = new JSONObject("{\"big\":5000000000,\"whole\":52428800.0}");

        assertEquals(5_000_000_000L, PluginArgs.positiveWholeNumber(data.opt("big")));
        assertEquals(52_428_800L, PluginArgs.positiveWholeNumber(data.opt("whole")));
    }

    @Test
    public void rejectsMissingAndInvalidValues() {
        assertEquals(-1L, PluginArgs.positiveWholeNumber(null));
        assertEquals(-1L, PluginArgs.positiveWholeNumber("2048"));
        assertEquals(-1L, PluginArgs.positiveWholeNumber(0));
        assertEquals(-1L, PluginArgs.positiveWholeNumber(-5));
        assertEquals(-1L, PluginArgs.positiveWholeNumber(1.5d));
        assertEquals(-1L, PluginArgs.positiveWholeNumber(Double.NaN));
    }
}
