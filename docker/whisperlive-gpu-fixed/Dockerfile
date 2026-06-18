# Patched WhisperLive GPU image.
# The upstream ghcr.io/collabora/whisperlive-gpu:latest ships CUDA 13 libs,
# but ctranslate2 4.8.0 / faster-whisper 1.2.0 are built against CUDA 12 and
# need libcublas.so.12 + cuDNN 9 for CUDA 12. Add those and put them on the
# loader path so GPU transcription works.
FROM ghcr.io/collabora/whisperlive-gpu:latest
RUN pip install --no-cache-dir nvidia-cublas-cu12 nvidia-cudnn-cu12
ENV LD_LIBRARY_PATH=/usr/local/lib/python3.10/site-packages/nvidia/cublas/lib:/usr/local/lib/python3.10/site-packages/nvidia/cudnn/lib
