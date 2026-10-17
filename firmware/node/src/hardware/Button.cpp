#include <Arduino.h>
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "Config.h"
#include "Button.h"
#include "Led.h"

static bool btnLastRaw = HIGH;
static bool btnStable = HIGH;
static unsigned long btnLastChange = 0;
static unsigned long pressStart = 0;
static bool gatewayHoldShown = false;
static bool resetHoldShown = false;
static QueueHandle_t actionQueue = nullptr;
static TaskHandle_t fieldTaskHandle = nullptr;

static void queueAction(ButtonAction action) {
  if (actionQueue) xQueueSendToBack(actionQueue, &action, 0);
}

static void pollButton() {
  const unsigned long now = millis();
  const bool raw = digitalRead(BUTTON_PIN);

  if (raw != btnLastRaw) {
    btnLastRaw = raw;
    btnLastChange = now;
  }

  if ((now - btnLastChange) >= 30 && raw != btnStable) {
    btnStable = raw;
    if (btnStable == LOW) {
      pressStart = now;
      gatewayHoldShown = false;
      resetHoldShown = false;
    } else {
      const unsigned long duration = now - pressStart;
      setButtonIndicator(BUTTON_INDICATOR_NONE);

      if (duration >= FULL_TEST_RESET_HOLD_MS) {
        queueAction(BUTTON_ACTION_FULL_RESET);
      } else if (duration >= GATEWAY_HOLD_MS) {
        queueAction(BUTTON_ACTION_GATEWAY_TOGGLE);
      } else if (duration < SHORT_PRESS_MS) {
        queueAction(BUTTON_ACTION_BASELINE_TOGGLE);
      }
    }
  }

  if (btnStable != LOW) return;
  const unsigned long duration = now - pressStart;

  if (duration >= FULL_TEST_RESET_HOLD_MS && !resetHoldShown) {
    resetHoldShown = true;
    setButtonIndicator(BUTTON_RESET_READY);
  } else if (duration >= GATEWAY_HOLD_MS && !gatewayHoldShown) {
    gatewayHoldShown = true;
    setButtonIndicator(BUTTON_GATEWAY_READY);
  }
}

static void fieldInterfaceTask(void*) {
  btnLastRaw = digitalRead(BUTTON_PIN);
  btnStable = btnLastRaw;
  btnLastChange = millis();

  for (;;) {
    pollButton();
    updateLed();
    vTaskDelay(pdMS_TO_TICKS(5));
  }
}

void startFieldInterfaceTask() {
  if (fieldTaskHandle) return;
  actionQueue = xQueueCreate(8, sizeof(ButtonAction));
  if (!actionQueue) {
    Serial.println("[field] failed to create button action queue");
    return;
  }

  const BaseType_t created = xTaskCreatePinnedToCore(
    fieldInterfaceTask,
    "field-interface",
    3072,
    nullptr,
    2,
    &fieldTaskHandle,
    ARDUINO_RUNNING_CORE
  );
  if (created != pdPASS) {
    fieldTaskHandle = nullptr;
    Serial.println("[field] failed to start button/LED task");
    return;
  }
  Serial.println("[field] button/LED task started (5 ms)");
}

bool takeButtonAction(ButtonAction& action) {
  if (!actionQueue) return false;
  return xQueueReceive(actionQueue, &action, 0) == pdTRUE;
}
