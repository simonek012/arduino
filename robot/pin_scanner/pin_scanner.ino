/*
 * pin_scanner - zisti, co je zapojene na robotovi.
 *
 *  1. Automaticky najde ultrazvukove senzory HC-SR04 (dvojice TRIG + ECHO).
 *  2. Ukazuje ich vzdialenosti, aby sa dalo urcit, ktory je predny a ktory bocny.
 *  3. Postupne prepina zvysne piny, aby sa dalo urcit, ktory pin motor drivera
 *     ovlada ktore koleso a ktorym smerom.
 *
 * Pouzitie (Arduino Uno / Nano):
 *  - nahraj sketch, otvor Serial Monitor, 115200 baud, koniec riadku "Newline",
 *  - ROBOTA PODLOZ, aby sa kolesa volne tocili a nikam neodisiel,
 *  - postupuj podla vypisov a vysledky si zapis.
 *
 * Pre Arduino Mega uprav zoznam PINS.
 */

// Piny, ktore sa skenuju. D0/D1 su vynechane (USB seriova linka).
const uint8_t PINS[] = {2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, A0, A1, A2, A3, A4, A5};
const uint8_t NPINS = sizeof(PINS);

const uint8_t NONE = 255;
const uint8_t MAX_SONARS = 4;
const unsigned long LISTEN_US = 60000UL;
const unsigned long MIN_ECHO_US = 100;

struct Sonar {
  uint8_t trig;
  uint8_t echo;
};

Sonar sonars[MAX_SONARS];
uint8_t nSonars = 0;

void printPin(uint8_t p) {
  if (p >= A0) {
    Serial.print('A');
    Serial.print(p - A0);
  } else {
    Serial.print('D');
    Serial.print(p);
  }
}

// Caka na znak zo Serial Monitora a zahodi zvysok riadku.
char waitKey() {
  while (Serial.available()) Serial.read();
  while (!Serial.available()) {}
  char c = Serial.read();
  delay(20);
  while (Serial.available()) Serial.read();
  return c;
}

bool isSonarPin(uint8_t p) {
  for (uint8_t i = 0; i < nSonars; i++)
    if (sonars[i].trig == p || sonars[i].echo == p) return true;
  return false;
}

// Vsetky piny ako vstup s pull-up: nezapojene piny citaju HIGH, ECHO senzora
// v kludovom stave drzi LOW a vstupy drivera dostanu HIGH, takze motory brzdia.
void releaseAll() {
  for (uint8_t i = 0; i < NPINS; i++) pinMode(PINS[i], INPUT_PULLUP);
}

void triggerPulse(uint8_t trig) {
  digitalWrite(trig, LOW);
  pinMode(trig, OUTPUT);
  delayMicroseconds(4);
  digitalWrite(trig, HIGH);
  delayMicroseconds(10);
  digitalWrite(trig, LOW);
}

// Sleduje piny oznacene vo `watch` po dobu LISTEN_US. Vrati index pinu, na
// ktorom prisiel impulz LOW -> HIGH -> LOW, a jeho dlzku v us; inak NONE.
uint8_t listen(const bool watch[], unsigned long &width) {
  bool rose[NPINS] = {false};
  unsigned long riseAt[NPINS];
  unsigned long start = micros();

  while (micros() - start < LISTEN_US) {
    unsigned long now = micros();
    for (uint8_t i = 0; i < NPINS; i++) {
      if (!watch[i]) continue;
      bool high = digitalRead(PINS[i]) == HIGH;
      if (high && !rose[i]) {
        rose[i] = true;
        riseAt[i] = now;
      } else if (!high && rose[i]) {
        width = now - riseAt[i];
        if (width >= MIN_ECHO_US) return i;
        rose[i] = false;  // kratky zakmit, ignorovat
      }
    }
  }

  // Impulz, ktory zacal, ale neskoncil (pred senzorom nic nie je).
  for (uint8_t i = 0; i < NPINS; i++) {
    if (rose[i]) {
      width = micros() - riseAt[i];
      return i;
    }
  }
  return NONE;
}

// Posle spustaci impulz na pin `trig` a vrati index pinu, na ktorom odpovedal
// ECHO, alebo NONE.
uint8_t probe(uint8_t trig, unsigned long &width) {
  releaseAll();
  delay(250);  // nech dobehnu pripadne merania spustene zmenou stavu pinov

  bool watch[NPINS];
  for (uint8_t i = 0; i < NPINS; i++)
    watch[i] = PINS[i] != trig && !isSonarPin(PINS[i]) && digitalRead(PINS[i]) == LOW;

  // Kontrolne sledovanie bez impulzu: piny, ktore sa menia samy, vyradime.
  uint8_t noisy;
  while ((noisy = listen(watch, width)) != NONE) watch[noisy] = false;

  triggerPulse(trig);
  return listen(watch, width);
}

void scanSonars() {
  Serial.println(F("\n=== 1. Hladam ultrazvukove senzory ==="));
  for (uint8_t t = 0; t < NPINS && nSonars < MAX_SONARS; t++) {
    uint8_t trig = PINS[t];
    if (isSonarPin(trig)) continue;
    Serial.print('.');

    unsigned long width;
    uint8_t e = probe(trig, width);
    if (e == NONE) continue;

    // Over to este dvakrat, nech nejde o nahodu.
    uint8_t hits = 1;
    for (uint8_t k = 0; k < 2; k++) {
      unsigned long w;
      if (probe(trig, w) == e) hits++;
    }
    if (hits < 2) continue;

    sonars[nSonars++] = {trig, PINS[e]};
    Serial.print(F("\n  Senzor S"));
    Serial.print(nSonars);
    Serial.print(F(": TRIG = "));
    printPin(trig);
    Serial.print(F(", ECHO = "));
    printPin(PINS[e]);
    Serial.print(F("  (~"));
    Serial.print(width / 58);
    Serial.println(F(" cm)"));
  }
  releaseAll();

  Serial.print(F("\nNajdenych senzorov: "));
  Serial.println(nSonars);
  if (nSonars < 2)
    Serial.println(F("  Ak nejaky chyba, skontroluj VCC na 5V a spolocnu GND."));
}

long measureCm(const Sonar &s) {
  pinMode(s.echo, INPUT);
  triggerPulse(s.trig);
  unsigned long us = pulseIn(s.echo, HIGH, 30000UL);
  return us == 0 ? -1 : (long)(us / 58);
}

void showDistances() {
  if (nSonars == 0) return;
  Serial.println(F("\n=== 2. Ktory senzor je predny a ktory bocny? ==="));
  Serial.println(F("Daj ruku ~10 cm pred PREDNY senzor - jeho hodnota klesne."));
  Serial.println(F("Enter = pokracovat. Stlac Enter pre start vypisu."));
  waitKey();

  releaseAll();
  while (Serial.available()) Serial.read();
  while (!Serial.available()) {
    for (uint8_t i = 0; i < nSonars; i++) {
      long cm = measureCm(sonars[i]);
      Serial.print(F("S"));
      Serial.print(i + 1);
      Serial.print(F(": "));
      if (cm < 0) Serial.print(F("---"));
      else Serial.print(cm);
      Serial.print(F(" cm    "));
      delay(60);  // nech sa ozveny senzorov navzajom neovplyvnuju
    }
    Serial.println();
    delay(250);
  }
  while (Serial.available()) Serial.read();
}

void setOutputs(const uint8_t pins[], uint8_t n, uint8_t lowIndex, bool othersHigh) {
  for (uint8_t i = 0; i < n; i++) {
    digitalWrite(pins[i], (i != lowIndex && othersHigh) ? HIGH : LOW);
    pinMode(pins[i], OUTPUT);
  }
}

void motorTest() {
  Serial.println(F("\n=== 3. Test motorov ==="));
  Serial.println(F("POZOR: ROBOT MUSI BYT PODLOZENY - kolesa sa budu tocit!"));
  if (nSonars < 2)
    Serial.println(F("POZOR: nenasli sa 2 senzory, ich piny mozu byt v teste tiez."));
  Serial.println(F("V kazdom kroku bude jeden pin LOW a vsetky ostatne HIGH (2 s)."));
  Serial.println(F("Zapis si, ktore koleso sa toci a ktorym smerom (alebo nic)."));
  Serial.println(F("Napis 'm' + Enter pre start, cokolvek ine = preskocit."));
  if (waitKey() != 'm') return;

  uint8_t pins[NPINS];
  uint8_t n = 0;
  for (uint8_t i = 0; i < NPINS; i++)
    if (!isSonarPin(PINS[i])) pins[n++] = PINS[i];

  uint8_t i = 0;
  while (i < n) {
    setOutputs(pins, n, NONE, false);  // vsetko LOW = stop
    delay(500);

    Serial.print(F("["));
    Serial.print(i + 1);
    Serial.print('/');
    Serial.print(n);
    Serial.print(F("] "));
    printPin(pins[i]);
    Serial.println(F(" = LOW, ostatne HIGH ..."));
    setOutputs(pins, n, i, true);
    delay(2000);
    setOutputs(pins, n, NONE, false);

    Serial.println(F("      Enter = dalsi pin, 'r' = zopakovat, 'q' = koniec"));
    char c = waitKey();
    if (c == 'q') break;
    if (c != 'r') i++;
  }
  setOutputs(pins, n, NONE, false);

  Serial.println(F("\nPin, pri ktorom sa toci koleso, je vstup drivera (IN1..IN4)."));
  Serial.println(F("Pin, pri ktorom sa nic nehybe, je ENA/ENB/PWM/STBY alebo nezapojeny."));
}

void printSummary() {
  Serial.println(F("\n=== Vysledok ==="));
  for (uint8_t i = 0; i < nSonars; i++) {
    Serial.print(F("S"));
    Serial.print(i + 1);
    Serial.print(F(": TRIG "));
    printPin(sonars[i].trig);
    Serial.print(F(", ECHO "));
    printPin(sonars[i].echo);
    Serial.println();
  }
  Serial.println(F("Skopiruj tento vypis + poznamky k motorom a posli ich."));
}

void setup() {
  Serial.begin(115200);
  while (!Serial) {}
  releaseAll();

  Serial.println(F("\nRobot pin scanner"));
  Serial.println(F("Podloz robota, aby sa kolesa volne tocili."));
  Serial.println(F("Stlac Enter pre start."));
  waitKey();

  scanSonars();
  showDistances();
  motorTest();
  printSummary();
}

void loop() {}
