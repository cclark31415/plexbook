package com.chrisclark.plexbook;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.Bundle;
import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.CommandButton;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import androidx.media3.session.SessionCommand;
import androidx.media3.session.SessionCommands;
import androidx.media3.session.SessionResult;
import com.google.common.collect.ImmutableList;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;

public class PlaybackService extends MediaSessionService {
    public static final String ACTION_REWIND_30 = "ACTION_REWIND_30";
    public static final String ACTION_FORWARD_30 = "ACTION_FORWARD_30";

    private MediaSession mediaSession = null;
    private ExoPlayer player = null;

    @Override
    public void onCreate() {
        super.onCreate();
        player = new ExoPlayer.Builder(this)
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
                        .add(Player.COMMAND_SEEK_BACK)
                        .add(Player.COMMAND_SEEK_FORWARD)
                        .add(Player.COMMAND_PLAY_PAUSE)
                        .add(Player.COMMAND_SEEK_TO_MEDIA_ITEM)
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

    @UnstableApi
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
