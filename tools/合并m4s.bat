@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "FFMPEG="
where ffmpeg >nul 2>nul && set "FFMPEG=ffmpeg"
if not defined FFMPEG if exist "%~dp0ffmpeg.exe" set "FFMPEG=%~dp0ffmpeg.exe"
if not defined FFMPEG if exist "%USERPROFILE%\beyonddown\bin\ffmpeg.exe" set "FFMPEG=%USERPROFILE%\beyonddown\bin\ffmpeg.exe"
if not defined FFMPEG (
    echo [错误] 未找到 ffmpeg：请加入 PATH，或放到本脚本同目录
    pause
    exit /b 1
)

set /a n=0
for %%F in ("*.video.m4s") do (
    set "base=%%~nF"
    set "base=!base:.video=!"
    if exist "!base!.audio.m4s" (
        echo 合并：!base!
        "%FFMPEG%" -y -i "%%F" -i "!base!.audio.m4s" -c copy "!base!.mp4"
        if not errorlevel 1 (
            del "%%F" "!base!.audio.m4s"
            set /a n+=1
        ) else (
            echo [失败] !base!，源文件已保留
        )
    ) else (
        echo [跳过] %%~nxF 没有配对的音频流
    )
)

echo.
echo 处理完成，共 !n! 个视频。
pause
