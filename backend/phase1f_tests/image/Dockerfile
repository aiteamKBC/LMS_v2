FROM python:3.14.3-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_CONFIG_FILE=/dev/null
COPY requirements.txt /tmp/requirements.txt
COPY constraints.txt /tmp/constraints.txt
RUN python -m pip --isolated install --no-cache-dir --only-binary=:all: --index-url https://pypi.org/simple -c /tmp/constraints.txt -r /tmp/requirements.txt
WORKDIR /work
ENTRYPOINT ["python", "-B"]
