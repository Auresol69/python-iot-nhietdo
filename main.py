from machine import Pin
import dht
import network
import time
import urequests
import ujson
from umqtt.simple import MQTTClient

# =========================
# WIFI
# =========================

wifi = network.WLAN(network.STA_IF)
wifi.active(True)

print("Dang ket noi WiFi...")

wifi.connect("AndroidAP1C83", "ShirokoRio")

while not wifi.isconnected():
    time.sleep(1)

print("WiFi Connected!")
print(wifi.ifconfig())

# =========================
# MQTT CONFIG
# =========================

MQTT_CLIENT_ID = "esp32_temp_sensor"
MQTT_BROKER = "broker.hivemq.com"
MQTT_PORT = 1883
MQTT_USER = ""
MQTT_PASSWORD = ""
MQTT_TOPIC_METRICS = "iot/devices/esp32-phong-may-1/metrics"

# =========================
# MQTT CONNECT
# =========================

def connect_mqtt():
    print("Dang ket noi MQTT...")
    c = MQTTClient(
        MQTT_CLIENT_ID,
        MQTT_BROKER,
        port = MQTT_PORT,
        user=None,
        password=None
    )
    c.connect()
    print("MQTT Connected!")
    return c

client = connect_mqtt()

# =========================
# SENSOR
# =========================

sensor = dht.DHT22(Pin(4))

# =========================
# DISCORD
# =========================

WEBHOOK_URL = "https://discord.com/api/webhooks/1506094370653212733/iuQiChdVTxvfnInR4hoUKakyMOHXRMfSoMNjcYmx6kKhlaj3mjcyNAy6gD2WolMCnJMC"

alert_sent = False

# =========================
# MAIN LOOP
# =========================

while True:

    try:
        # Chờ cảm biến ổn định
        time.sleep(2)
        sensor.measure()
        time.sleep(0.5)

        temp = sensor.temperature()
        humid = sensor.humidity()

        print("===================")
        print("Temp:", temp)
        print("Humidity:", humid)

        # =========================
        # MQTT PUBLISH
        # =========================

        try:
            payload = ujson.dumps({"temperature": temp, "humidity": humid})
            client.publish(MQTT_TOPIC_METRICS, payload, retain=False)
            print("Da publish MQTT!")

        except OSError as e:
            print("MQTT loi:", e)
            print("Dang reconnect MQTT...")
            try:
                client = connect_mqtt()
                payload = ujson.dumps({"temperature": temp, "humidity": humid})
                client.publish(MQTT_TOPIC_METRICS, payload, retain=False)
                print("Reconnect thanh cong!")
            except Exception as e:
                print("Reconnect that bai:", e)

        # =========================
        # DISCORD ALERT
        # =========================

        if temp >= 30 and not alert_sent:

            payload = """
{
    "embeds": [{
        "title": "CANH BAO NHIET DO",
        "description": "Nhiet do phong dang qua cao!",
        "color": 16711680,
        "fields": [
            {
                "name": "Nhiet do",
                "value": "%d C",
                "inline": true
            },
            {
                "name": "Do am",
                "value": "%d%%",
                "inline": true
            }
        ]
    }]
}
""" % (temp, humid)

            try:
                response = urequests.post(
                    WEBHOOK_URL,
                    data=payload,
                    headers={
                        "Content-Type": "application/json"
                    }
                )
                print("Discord:", response.status_code)
                response.close()
                if response.status_code == 204:
                    alert_sent = True

            except Exception as e:
                print("Discord loi:", e)
                alert_sent = False

        elif temp < 30:
            alert_sent = False

    except Exception as e:
        print("Loi:", e)

    time.sleep(3) 