package com.chrisclark.plexbook;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import java.net.FileNameMap;
import java.net.URLConnection;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        final FileNameMap defaultMap = URLConnection.getFileNameMap();
        URLConnection.setFileNameMap(new FileNameMap() {
            @Override
            public String getContentTypeFor(String fileName) {
                if (fileName != null) {
                    String lower = fileName.toLowerCase();
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
        super.onCreate(savedInstanceState);
    }
}
