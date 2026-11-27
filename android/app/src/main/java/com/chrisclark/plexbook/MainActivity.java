package com.chrisclark.plexbook;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.net.FileNameMap;
import java.net.URLConnection;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaSessionPlugin.class);
        super.onCreate(savedInstanceState);

        boolean isDark = false;
        try {
            android.content.SharedPreferences prefs = getSharedPreferences("CapacitorStorage", MODE_PRIVATE);
            String theme = prefs.getString("theme", null);
            if ("dark".equals(theme)) {
                isDark = true;
            } else if (theme == null) {
                int nightModeFlags = getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK;
                isDark = (nightModeFlags == android.content.res.Configuration.UI_MODE_NIGHT_YES);
            }
        } catch (Exception e) {}

        if (getWindow() != null) {
            int color = isDark ? 0xFF1A1410 : 0xFFF4F0EB;
            getWindow().setStatusBarColor(color);
            getWindow().setNavigationBarColor(color);
            WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            if (controller != null) {
                controller.setAppearanceLightStatusBars(!isDark);
                controller.setAppearanceLightNavigationBars(!isDark);
            }
        }

        final FileNameMap defaultMap = URLConnection.getFileNameMap();
        URLConnection.setFileNameMap(new FileNameMap() {
            @Override
            public String getContentTypeFor(String fileName) {
                if (fileName != null) {
                    String lower = fileName.toLowerCase(Locale.ROOT);
                    if (lower.endsWith(".m4b") || lower.endsWith(".m4a") || lower.endsWith(".mp4")) {
                        return "audio/mp4";
                    }
                    if (lower.endsWith(".mp3")) {
                        return "audio/mpeg";
                    }
                    if (lower.endsWith(".ogg") || lower.endsWith(".oga")) {
                        return "audio/ogg";
                    }
                    if (lower.endsWith(".flac")) {
                        return "audio/flac";
                    }
                    if (lower.endsWith(".wav")) {
                        return "audio/wav";
                    }
                    if (lower.endsWith(".opus")) {
                        return "audio/opus";
                    }
                    if (lower.endsWith(".aac")) {
                        return "audio/aac";
                    }
                }
                return defaultMap != null ? defaultMap.getContentTypeFor(fileName) : null;
            }
        });
    }
}
