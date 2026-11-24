package com.chrisclark.plexbook;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.Player;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.audio.BaseAudioProcessor;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.Renderer;
import androidx.media3.exoplayer.audio.AudioRendererEventListener;
import androidx.media3.exoplayer.audio.AudioSink;
import androidx.media3.exoplayer.audio.DefaultAudioSink;
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector;
import androidx.media3.session.CommandButton;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import androidx.media3.session.SessionCommand;
import androidx.media3.session.SessionCommands;
import androidx.media3.session.SessionResult;
import com.google.common.collect.ImmutableList;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;

@UnstableApi
public class PlaybackService extends MediaSessionService {
    public static final String ACTION_REWIND_30 = "ACTION_REWIND_30";
    public static final String ACTION_FORWARD_30 = "ACTION_FORWARD_30";

    private MediaSession mediaSession = null;
    private ExoPlayer player = null;
    private static final CustomAudioProcessor audioProcessor = new CustomAudioProcessor();

    public static float[] getFftFrequencies() {
        return CustomAudioProcessor.getFrequencies();
    }

    public static class CustomAudioProcessor extends BaseAudioProcessor {
        public static final float[] pcmFrequencies = new float[32];

        public static float[] getFrequencies() {
            return pcmFrequencies;
        }

        @Override
        public AudioFormat onConfigure(AudioFormat inputAudioFormat) throws UnhandledAudioFormatException {
            return inputAudioFormat;
        }

        @Override
        public void queueInput(ByteBuffer inputBuffer) {
            int remaining = inputBuffer.remaining();
            if (remaining <= 0) return;

            int samples = remaining / 2;
            if (samples >= 32) {
                int step = samples / 32;
                ByteOrder originalOrder = inputBuffer.order();
                inputBuffer.order(ByteOrder.LITTLE_ENDIAN);
                int originalPosition = inputBuffer.position();

                for (int i = 0; i < 32; i++) {
                    int pos = originalPosition + (i * step * 2);
                    if (pos + 1 < originalPosition + remaining) {
                        short sample = inputBuffer.getShort(pos);
                        float amp = Math.abs(sample) / 32768.0f;
                        pcmFrequencies[i] = pcmFrequencies[i] * 0.3f + amp * 0.7f;
                    }
                }
                inputBuffer.order(originalOrder);
                inputBuffer.position(originalPosition);
            }

            ByteBuffer buffer = replaceOutputBuffer(remaining);
            buffer.put(inputBuffer);
            buffer.flip();
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();

        DefaultAudioSink customAudioSink = new DefaultAudioSink.Builder(this)
            .setAudioProcessors(new AudioProcessor[]{ audioProcessor })
            .build();

        DefaultRenderersFactory renderersFactory = new DefaultRenderersFactory(this) {
            @Override
            protected void buildAudioRenderers(
                Context context,
                int extensionRendererMode,
                MediaCodecSelector mediaCodecSelector,
                boolean enableDecoderFallback,
                AudioSink audioSink,
                Handler eventHandler,
                AudioRendererEventListener eventListener,
                ArrayList<Renderer> out) {
                super.buildAudioRenderers(
                    context,
                    extensionRendererMode,
                    mediaCodecSelector,
                    enableDecoderFallback,
                    customAudioSink,
                    eventHandler,
                    eventListener,
                    out
                );
            }
        };

        player = new ExoPlayer.Builder(this, renderersFactory)
            .setAudioAttributes(AudioAttributes.DEFAULT, true)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .setSeekBackIncrementMs(30000)
            .setSeekForwardIncrementMs(30000)
            .build();

        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        SessionCommand customRewind = new SessionCommand(ACTION_REWIND_30, Bundle.EMPTY);
        SessionCommand customForward = new SessionCommand(ACTION_FORWARD_30, Bundle.EMPTY);

        CommandButton rewindButton = new CommandButton.Builder(CommandButton.ICON_REWIND)
            .setDisplayName("-30s")
            .setSessionCommand(customRewind)
            .build();

        CommandButton forwardButton = new CommandButton.Builder(CommandButton.ICON_FAST_FORWARD)
            .setDisplayName("+30s")
            .setSessionCommand(customForward)
            .build();

        mediaSession = new MediaSession.Builder(this, player)
            .setSessionActivity(pendingIntent)
            .setMediaButtonPreferences(ImmutableList.of(rewindButton, forwardButton))
            .setCustomLayout(ImmutableList.of(rewindButton, forwardButton))
            .setCallback(new MediaSession.Callback() {
                @Override
                public MediaSession.ConnectionResult onConnect(
                    MediaSession session,
                    MediaSession.ControllerInfo controller) {
                    MediaSession.ConnectionResult defaultResult =
                        MediaSession.Callback.super.onConnect(session, controller);

                    SessionCommands sessionCommands = defaultResult.availableSessionCommands
                        .buildUpon()
                        .add(customRewind)
                        .add(customForward)
                        .build();

                    Player.Commands playerCommands = defaultResult.availablePlayerCommands
                        .buildUpon()
                        .add(Player.COMMAND_PLAY_PAUSE)
                        .add(Player.COMMAND_PREPARE)
                        .add(Player.COMMAND_SEEK_BACK)
                        .add(Player.COMMAND_SEEK_FORWARD)
                        .add(Player.COMMAND_SEEK_TO_MEDIA_ITEM)
                        .add(Player.COMMAND_SEEK_TO_NEXT)
                        .add(Player.COMMAND_SEEK_TO_PREVIOUS)
                        .add(Player.COMMAND_SET_SPEED_AND_PITCH)
                        .add(Player.COMMAND_GET_CURRENT_MEDIA_ITEM)
                        .add(Player.COMMAND_GET_TIMELINE)
                        .build();

                    return MediaSession.ConnectionResult.accept(sessionCommands, playerCommands);
                }

                @Override
                public ListenableFuture<SessionResult> onCustomCommand(
                    MediaSession session,
                    MediaSession.ControllerInfo controller,
                    SessionCommand customCommand,
                    Bundle args) {
                    if (ACTION_REWIND_30.equals(customCommand.customAction)) {
                        session.getPlayer().seekBack();
                        return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_SUCCESS));
                    } else if (ACTION_FORWARD_30.equals(customCommand.customAction)) {
                        session.getPlayer().seekForward();
                        return Futures.immediateFuture(new SessionResult(SessionResult.RESULT_SUCCESS));
                    }
                    return MediaSession.Callback.super.onCustomCommand(session, controller, customCommand, args);
                }
            })
            .build();
    }

    @Override
    public void onTaskRemoved(@Nullable Intent rootIntent) {
        // Keep foreground service persistent
    }

    @Override
    public void onDestroy() {
        if (player != null) {
            player.release();
            player = null;
        }
        if (mediaSession != null) {
            mediaSession.release();
            mediaSession = null;
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return mediaSession;
    }
}
