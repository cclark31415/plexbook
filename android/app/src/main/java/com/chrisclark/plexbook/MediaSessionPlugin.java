package com.chrisclark.plexbook;

import android.content.ComponentName;
import android.content.Context;
import android.net.Uri;
import android.view.Window;
import androidx.annotation.Nullable;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.MoreExecutors;

@CapacitorPlugin(name = "MediaSession")
public class MediaSessionPlugin extends Plugin {

    private MediaController mediaController;
    private ListenableFuture<MediaController> controllerFuture;
    private long lastRequestedPositionMs = 0L;

    private Long getPositionFromCall(PluginCall call) {
        Long l = call.getLong("position");
        if (l != null) return l;
        Double d = call.getDouble("position");
        if (d != null) return d.longValue();
        Integer i = call.getInt("position");
        if (i != null) return i.longValue();
        return null;
    }

    private String resolveMediaUri(String url) {
        if (url == null) return null;
        if (url.contains("/_capacitor_file_")) {
            return url.replaceAll("https?://[^/]+/_capacitor_file_", "file://");
        }
        return url;
    }

    private void executeWhenControllerReady(Runnable runnable) {
        if (mediaController != null) {
            getBridge().executeOnMainThread(runnable);
        } else if (controllerFuture != null) {
            controllerFuture.addListener(() -> {
                getBridge().executeOnMainThread(runnable);
            }, MoreExecutors.directExecutor());
        }
    }

    @Override
    public void load() {
        super.load();
        Context context = getContext();
        SessionToken sessionToken = new SessionToken(context, new ComponentName(context, PlaybackService.class));
        controllerFuture = new MediaController.Builder(context, sessionToken).buildAsync();
        controllerFuture.addListener(() -> {
            try {
                mediaController = controllerFuture.get();
                setupControllerListener();
            } catch (Exception e) {
                e.printStackTrace();
            }
        }, MoreExecutors.directExecutor());
    }

    @Override
    protected void handleOnDestroy() {
        if (controllerFuture != null) {
            MediaController.releaseFuture(controllerFuture);
            controllerFuture = null;
            mediaController = null;
        }
        super.handleOnDestroy();
    }

    private void setupControllerListener() {
        if (mediaController == null) return;
        mediaController.addListener(new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                JSObject ret = new JSObject();
                ret.put("isPlaying", isPlaying);
                notifyListeners("onPlaybackStateChanged", ret);
            }

            @Override
            public void onMediaItemTransition(@Nullable MediaItem mediaItem, int reason) {
                if (mediaController != null) {
                    long posMs = mediaController.getCurrentPosition();
                    if (posMs == 0 && lastRequestedPositionMs > 0) {
                        posMs = lastRequestedPositionMs;
                    }
                    JSObject ret = new JSObject();
                    ret.put("mediaItemIndex", mediaController.getCurrentMediaItemIndex());
                    ret.put("position", posMs);
                    notifyListeners("onTrackChanged", ret);
                }
            }

            @Override
            public void onPositionDiscontinuity(Player.PositionInfo oldPosition, Player.PositionInfo newPosition, int reason) {
                if (mediaController == null) return;
                long actualPosMs = mediaController.getCurrentPosition();
                long posMs = actualPosMs > 0 ? actualPosMs : newPosition.positionMs;

                // Ignore transient 0 ms position events right after loading if a non-zero position was requested
                if (posMs == 0 && lastRequestedPositionMs > 0) {
                    return;
                }
                JSObject ret = new JSObject();
                ret.put("position", posMs);
                ret.put("oldPosition", oldPosition.positionMs);
                notifyListeners("onPositionChanged", ret);
            }

            @Override
            public void onPlaybackStateChanged(int playbackState) {
                if (mediaController != null) {
                    JSObject ret = new JSObject();
                    long duration = mediaController.getDuration();
                    long position = mediaController.getCurrentPosition();
                    if (position == 0 && lastRequestedPositionMs > 0) {
                        position = lastRequestedPositionMs;
                    }
                    ret.put("duration", duration > 0 ? duration : 0);
                    ret.put("position", position > 0 ? position : 0);
                    notifyListeners("onDurationChanged", ret);
                }
            }
        });
    }

    @PluginMethod
    public void getFrequencyData(PluginCall call) {
        JSObject ret = new JSObject();
        JSArray arr = new JSArray();
        float[] freqs = PlaybackService.getFftFrequencies();
        if (freqs != null) {
            for (float f : freqs) {
                try {
                    arr.put((double) f);
                } catch (Exception e) {}
            }
        }
        ret.put("frequencies", arr);
        call.resolve(ret);
    }

    @PluginMethod
    public void setStatusBarStyle(PluginCall call) {
        Boolean isDark = call.getBoolean("isDark", false);
        getBridge().executeOnMainThread(() -> {
            try {
                Window window = getBridge().getActivity().getWindow();
                WindowInsetsControllerCompat controller =
                    WindowCompat.getInsetsController(window, window.getDecorView());
                if (controller != null) {
                    boolean darkBg = isDark != null && isDark;
                    controller.setAppearanceLightStatusBars(!darkBg);
                    controller.setAppearanceLightNavigationBars(!darkBg);
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("Failed to set status bar style: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void loadMedia(PluginCall call) {
        String url = call.getString("url");
        String title = call.getString("title", "Unknown Title");
        String artist = call.getString("artist", "Unknown Artist");
        String artworkUrl = call.getString("artworkUrl");
        Long position = getPositionFromCall(call);

        if (url == null) {
            call.reject("URL is required");
            return;
        }

        if (url.startsWith("blob:")) {
            call.reject("Blob URL not supported natively");
            return;
        }

        final String finalMediaUrl = resolveMediaUri(url);
        final long startPositionMs = position != null ? position : 0L;
        lastRequestedPositionMs = startPositionMs;

        executeWhenControllerReady(() -> {
            if (mediaController != null) {
                MediaMetadata.Builder metaBuilder = new MediaMetadata.Builder()
                    .setTitle(title)
                    .setArtist(artist)
                    .setIsPlayable(true);

                if (artworkUrl != null && !artworkUrl.isEmpty()) {
                    try {
                        metaBuilder.setArtworkUri(Uri.parse(artworkUrl));
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }

                try {
                    MediaItem mediaItem = new MediaItem.Builder()
                        .setUri(Uri.parse(finalMediaUrl))
                        .setMediaMetadata(metaBuilder.build())
                        .build();

                    mediaController.setMediaItem(mediaItem, startPositionMs);
                    if (startPositionMs > 0) {
                        mediaController.seekTo(startPositionMs);
                    }
                    mediaController.prepare();
                    call.resolve();
                } catch (Exception e) {
                    call.reject("Failed to parse or load media URI: " + e.getMessage());
                }
            } else {
                call.reject("Media controller failed to connect");
            }
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        executeWhenControllerReady(() -> {
            if (mediaController != null) {
                mediaController.play();
                call.resolve();
            } else {
                call.reject("Media controller failed to connect");
            }
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        executeWhenControllerReady(() -> {
            if (mediaController != null) {
                mediaController.pause();
                call.resolve();
            } else {
                call.reject("Media controller failed to connect");
            }
        });
    }

    @PluginMethod
    public void seek(PluginCall call) {
        Long position = getPositionFromCall(call);
        if (position == null) {
            call.reject("Position is required");
            return;
        }

        lastRequestedPositionMs = position;

        executeWhenControllerReady(() -> {
            if (mediaController != null) {
                mediaController.seekTo(position);
                call.resolve();
            } else {
                call.reject("Media controller failed to connect");
            }
        });
    }

    @PluginMethod
    public void seekBack(PluginCall call) {
        executeWhenControllerReady(() -> {
            if (mediaController != null) {
                mediaController.seekBack();
                lastRequestedPositionMs = mediaController.getCurrentPosition();
                call.resolve();
            } else {
                call.reject("Media controller failed to connect");
            }
        });
    }

    @PluginMethod
    public void seekForward(PluginCall call) {
        executeWhenControllerReady(() -> {
            if (mediaController != null) {
                mediaController.seekForward();
                lastRequestedPositionMs = mediaController.getCurrentPosition();
                call.resolve();
            } else {
                call.reject("Media controller failed to connect");
            }
        });
    }

    @PluginMethod
    public void setSpeed(PluginCall call) {
        Float speed = call.getFloat("speed", 1.0f);
        executeWhenControllerReady(() -> {
            if (mediaController != null) {
                mediaController.setPlaybackSpeed(speed != null ? speed : 1.0f);
                call.resolve();
            } else {
                call.reject("Media controller failed to connect");
            }
        });
    }
}
