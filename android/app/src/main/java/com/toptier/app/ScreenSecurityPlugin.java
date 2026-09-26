package com.toptier.app;

import android.view.View;
import android.view.WindowManager;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * ScreenSecurityPlugin — toggles FLAG_SECURE on the WebView so Android
 * refuses to screenshot / screen-record while an e-book is open.
 */
@CapacitorPlugin(name = "ScreenSecurity")
public class ScreenSecurityPlugin extends Plugin {

    @PluginMethod
    public void enable(PluginCall call) {
        setFlagSecure(getActivity() != null && getActivity().getWindow() != null);
        call.resolve(new JSObject().put("enabled", true));
    }

    @PluginMethod
    public void disable(PluginCall call) {
        setFlagSecure(false);
        call.resolve(new JSObject().put("enabled", false));
    }

    private void setFlagSecure(boolean enabled) {
        try {
            final View view = getBridge().getWebView();
            view.post(() -> {
                view.setSystemUiVisibility(view.getSystemUiVisibility());
                if (enabled) {
                    view.setDrawingCacheEnabled(false);
                    getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
                } else {
                    getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
                }
            });
        } catch (Exception e) {
            // Never crash the app over a screenshot guard.
        }
    }
}