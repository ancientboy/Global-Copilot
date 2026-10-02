ARG STRATEGY_MODEL_IMAGE
FROM ${STRATEGY_MODEL_IMAGE}
COPY --chown=1001:1001 deploy/model_service.py /opt/copilot/model_service.py
COPY --chown=1001:1001 tests/model_service_test.py /opt/copilot/model_service_test.py
USER 1001:1001
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/opt/stewardos
RUN /opt/hermes/.venv/bin/python /opt/copilot/model_service_test.py
CMD ["/opt/hermes/.venv/bin/python", "/opt/copilot/model_service.py"]
