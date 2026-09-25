import React, { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import MapView, { Circle, Marker } from 'react-native-maps';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  SafeAreaView, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';

/* ===================== ТИПЫ ===================== */
type LatLng = { latitude: number; longitude: number };
type EquipmentStatus = 'PUBLISHED' | 'RESERVED' | 'BUSY';

type Equipment = {
  id: string;
  title: string;
  categoryName: string;
  status: EquipmentStatus;
  priceHour: number;
  currency: string;
  weight?: number;
  bucketVolume?: number;
  liftingCapacity?: number;
  minimumHours: number;
  deliveryAvailable: boolean;
  latitude: number;
  longitude: number;
  district: string;
  ownerName: string;
};

type Order = {
  number: string;
  item: Equipment;
  startLabel: string;
  hours: number;
  address: string;
  phone: string;
  totalPrice: number;
};

/* ===================== НАСТРОЙКИ ===================== */
const RADIUS_M = 25000; // радиус поиска на карте
const DELIVERY_PER_KM = 100; // ₽/км
const DEFAULT_LOCATION: LatLng = { latitude: 55.7558, longitude: 37.6173 }; // Москва

// Демо-данные техники (в Snack нет своего сервера, поэтому список зашит здесь)
const EQUIPMENT: Equipment[] = [
  { id: '1', title: 'JCB 3CX', categoryName: 'Погрузчики', status: 'PUBLISHED', priceHour: 3200, currency: 'RUB', weight: 8.1, bucketVolume: 1, minimumHours: 4, deliveryAvailable: true, latitude: 55.696, longitude: 37.505, district: 'ЗАО, Раменки', ownerName: 'Алексей И.' },
  { id: '2', title: 'CAT 320', categoryName: 'Экскаваторы', status: 'PUBLISHED', priceHour: 4800, currency: 'RUB', weight: 22.5, bucketVolume: 1.2, minimumHours: 4, deliveryAvailable: true, latitude: 55.805, longitude: 37.515, district: 'САО, Сокол', ownerName: 'Владимир С.' },
  { id: '3', title: 'MAN TGS 33.400', categoryName: 'Самосвалы', status: 'BUSY', priceHour: 2600, currency: 'RUB', weight: 26, bucketVolume: 20, minimumHours: 4, deliveryAvailable: true, latitude: 55.708, longitude: 37.625, district: 'ЮАО, Даниловский', ownerName: 'Игорь К.' },
  { id: '4', title: 'Эвакуатор ISUZU', categoryName: 'Эвакуаторы', status: 'PUBLISHED', priceHour: 2200, currency: 'RUB', weight: 5, minimumHours: 4, deliveryAvailable: true, latitude: 55.65, longitude: 37.745, district: 'ЮВАО, Марьино', ownerName: 'Дмитрий Н.' },
  { id: '5', title: 'Liebherr LTM 1050', categoryName: 'Краны', status: 'PUBLISHED', priceHour: 6500, currency: 'RUB', weight: 48, liftingCapacity: 50, minimumHours: 4, deliveryAvailable: true, latitude: 55.775, longitude: 37.495, district: 'СЗАО, Хорошево', ownerName: 'Михаил Р.' },
];

const C = {
  bg: '#121212', card: '#1E1E1E', card2: '#2A2A2A', border: '#333',
  text: '#fff', muted: '#888', soft: '#ccc', accent: '#F59E0B',
  green: '#10B981', red: '#EF4444',
};

const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#181818' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a8a8a' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#181818' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a2a2a' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
];

/* ===================== УТИЛИТЫ ===================== */
function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatMoney(value: number): string {
  const s = Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  return `${s}\u00A0₽`;
}

const isFree = (e: Equipment) => e.status === 'PUBLISHED';
const statusLabel = (e: Equipment) => (e.status === 'PUBLISHED' ? 'Свободна' : e.status === 'RESERVED' ? 'Забронирована' : 'Занята');

function specTags(e: Equipment): string[] {
  const tags: string[] = [];
  if (e.weight) tags.push(`⚖️ ${e.weight} т`);
  if (e.bucketVolume) tags.push(`📦 ${e.bucketVolume} м³`);
  if (e.liftingCapacity) tags.push(`🏗 г/п ${e.liftingCapacity} т`);
  return tags;
}

function estimateDelivery(e: Equipment, user: LatLng) {
  const km = distanceKm(user, { latitude: e.latitude, longitude: e.longitude });
  return { km, fee: e.deliveryAvailable ? Math.round(km * DELIVERY_PER_KM) : 0 };
}

/* ===================== ГЕОЛОКАЦИЯ ===================== */
type LocStatus = 'loading' | 'granted' | 'denied' | 'unavailable';
type UserLoc = { coords: LatLng; status: LocStatus; city: string };

function useUserLocation(enabled: boolean): [UserLoc, () => Promise<void>] {
  const [state, setState] = useState<UserLoc>({ coords: DEFAULT_LOCATION, status: 'loading', city: 'Москва' });

  const refresh = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setState({ coords: DEFAULT_LOCATION, status: 'denied', city: 'Москва' });
        return;
      }
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coords = { latitude: p.coords.latitude, longitude: p.coords.longitude };
      let city = 'Ваш город';
      try {
        const [g] = await Location.reverseGeocodeAsync(coords);
        city = g?.city ?? g?.subregion ?? g?.region ?? city;
      } catch {}
      setState({ coords, status: 'granted', city });
    } catch {
      setState({ coords: DEFAULT_LOCATION, status: 'unavailable', city: 'Москва' });
    }
  };

  useEffect(() => { if (enabled) refresh(); }, [enabled]);
  return [state, refresh];
}

/* ===================== МЕЛКИЕ КОМПОНЕНТЫ ===================== */
function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[cs.chip, active && cs.chipActive]} onPress={onPress}>
      <Text style={[cs.chipText, active && cs.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Pill({ item, selected }: { item: Equipment; selected?: boolean }) {
  const free = isFree(item);
  return (
    <View style={[cs.pill, selected && cs.pillSel, !free && cs.pillBusy]}>
      <View style={[cs.dot, { backgroundColor: free ? C.green : C.red }]} />
      <Text style={cs.pillText}>{formatMoney(item.priceHour)}/ч</Text>
    </View>
  );
}

function UserPin() {
  return (
    <View style={cs.userPin}>
      <Text style={cs.userPinText}>📍 Мой объект</Text>
    </View>
  );
}

/* ===================== ОНБОРДИНГ ===================== */
function OnboardingScreen({ onStart }: { onStart: () => void }) {
  return (
    <SafeAreaView style={[cs.container, { alignItems: 'center', justifyContent: 'center', padding: 24 }]}>
      <Text style={cs.logo}>SPEC</Text>
      <Text style={[cs.logo, { color: C.accent, marginTop: -10 }]}>KAYS</Text>
      <Text style={cs.subtitle}>Спецтехника рядом</Text>
      <TouchableOpacity style={[cs.btn, { width: '100%', height: 56, justifyContent: 'center' }]} onPress={onStart}>
        <Text style={cs.btnText}>Начать</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

function RoleScreen({ onPick }: { onPick: () => void }) {
  const roles: [string, string][] = [
    ['🔎', 'Мне нужна техника'],
    ['🚜', 'У меня есть техника'],
    ['🏢', 'Я представляю компанию'],
  ];
  return (
    <SafeAreaView style={[cs.container, { padding: 16 }]}>
      <Text style={cs.roleTitle0}>Что вам нужно?</Text>
      <Text style={cs.muted}>Вы сможете изменить это позже.</Text>
      {roles.map(([icon, title]) => (
        <TouchableOpacity key={title} style={cs.roleCard} onPress={onPick}>
          <Text style={{ fontSize: 34, marginRight: 16 }}>{icon}</Text>
          <Text style={cs.roleCardTitle}>{title}</Text>
        </TouchableOpacity>
      ))}
    </SafeAreaView>
  );
}

/* ===================== ГЛАВНЫЙ ЭКРАН ===================== */
function HomeScreen({
  equipment, loc, refreshLoc, onBook,
}: { equipment: Equipment[]; loc: UserLoc; refreshLoc: () => void; onBook: (e: Equipment) => void }) {
  const [tab, setTab] = useState<'list' | 'map'>('list');
  const [filter, setFilter] = useState('Все');
  const [query, setQuery] = useState('');

  const categories = ['Все', ...Array.from(new Set(equipment.map((e) => e.categoryName)))];
  const q = query.trim().toLowerCase();
  const data = equipment.filter(
    (e) => (filter === 'Все' || e.categoryName === filter) && (!q || e.title.toLowerCase().includes(q))
  );

  const notes: string[] = [];
  if (loc.status === 'denied') notes.push('Нет доступа к геолокации — используется Москва');
  if (loc.status === 'unavailable') notes.push('Геолокация недоступна — используется Москва');

  return (
    <SafeAreaView style={cs.container}>
      <View style={cs.header}>
        <View>
          <Text style={cs.muted}>📍 Ваш город</Text>
          <Text style={cs.headerTitle}>{loc.status === 'loading' ? 'Определяем…' : loc.city}</Text>
        </View>
        <Text style={cs.brand}>Spec<Text style={{ color: C.accent }}>Kays</Text></Text>
      </View>
      {notes.length > 0 && <Text style={cs.note}>{notes.join('\n')}</Text>}

      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <TextInput style={cs.input} value={query} onChangeText={setQuery} placeholder="🔎  Поиск техники..." placeholderTextColor="#666" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}>
          {categories.map((c) => <Chip key={c} label={c} active={filter === c} onPress={() => setFilter(c)} />)}
        </ScrollView>
        <View style={cs.switcher}>
          {(['list', 'map'] as const).map((t) => (
            <TouchableOpacity key={t} style={[cs.tab, tab === t && cs.tabActive]} onPress={() => setTab(t)}>
              <Text style={[cs.tabText, tab === t && { color: '#000', fontWeight: '700' }]}>{t === 'list' ? 'Список' : '🗺 Карта'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {tab === 'list' ? (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          {data.map((item) => <EquipmentCard key={item.id} item={item} user={loc.coords} onPress={() => onBook(item)} />)}
          {!data.length && <Text style={cs.muted}>Ничего не найдено.</Text>}
        </ScrollView>
      ) : (
        <MapTab data={data} loc={loc} refreshLoc={refreshLoc} onBook={onBook} />
      )}
    </SafeAreaView>
  );
}

function EquipmentCard({ item, user, onPress }: { item: Equipment; user: LatLng; onPress: () => void }) {
  const free = isFree(item);
  const km = distanceKm(user, { latitude: item.latitude, longitude: item.longitude });
  return (
    <TouchableOpacity style={cs.card} onPress={onPress} disabled={!free} activeOpacity={0.8}>
      <View style={cs.machine}><Text style={{ fontSize: 42 }}>🚜</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: free ? C.green : C.red, fontSize: 12, fontWeight: '700', marginBottom: 4 }}>● {statusLabel(item)}</Text>
        <Text style={cs.cardTitle}>{item.title}</Text>
        <Text style={cs.muted}>{item.categoryName}</Text>
        <Text style={cs.muted}>📍 {item.district} · {km.toFixed(1)} км</Text>
        <Text style={[cs.price, { fontSize: 17, marginTop: 8 }]}>{formatMoney(item.priceHour)} / час</Text>
      </View>
    </TouchableOpacity>
  );
}

function MapTab({
  data, loc, refreshLoc, onBook,
}: { data: Equipment[]; loc: UserLoc; refreshLoc: () => void; onBook: (e: Equipment) => void }) {
  const mapRef = useRef<MapView>(null);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState<Equipment | null>(null);
  const user = loc.coords;

  useEffect(() => {
    if (!ready) return;
    mapRef.current?.fitToCoordinates(
      [user, ...data.map((e) => ({ latitude: e.latitude, longitude: e.longitude }))],
      { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true }
    );
  }, [ready, data.map((e) => e.id).join(','), user.latitude, user.longitude]);

  const select = (item: Equipment) => {
    setActive(item);
    mapRef.current?.animateToRegion(
      { latitude: item.latitude - 0.03, longitude: item.longitude, latitudeDelta: 0.15, longitudeDelta: 0.15 },
      350
    );
  };

  return (
    <View style={{ flex: 1, marginTop: 4 }}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        initialRegion={{ ...user, latitudeDelta: 0.6, longitudeDelta: 0.6 }}
        customMapStyle={DARK_MAP_STYLE}
        userInterfaceStyle="dark"
        onMapReady={() => setReady(true)}
        onPress={() => setActive(null)}
        toolbarEnabled={false}
      >
        <Circle center={user} radius={RADIUS_M} strokeColor="rgba(245,158,11,0.4)" strokeWidth={2} fillColor="rgba(245,158,11,0.05)" />
        <Marker coordinate={user} anchor={{ x: 0.5, y: 1 }}><UserPin /></Marker>
        {data.map((e) => (
          <Marker
            key={e.id}
            coordinate={{ latitude: e.latitude, longitude: e.longitude }}
            anchor={{ x: 0.5, y: 0.5 }}
            onPress={(ev) => { ev.stopPropagation(); select(e); }}
          >
            <Pill item={e} selected={active?.id === e.id} />
          </Marker>
        ))}
      </MapView>

      <TouchableOpacity
        style={cs.locBtn}
        onPress={() => { refreshLoc(); mapRef.current?.animateToRegion({ ...user, latitudeDelta: 0.2, longitudeDelta: 0.2 }, 400); }}
      >
        <Text style={{ fontSize: 20 }}>🎯</Text>
      </TouchableOpacity>

      {active && (
        <View style={cs.bottomCard}>
          <View style={cs.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={cs.cardTitle}>{active.title}</Text>
              <Text style={cs.muted}>{active.categoryName} · {active.district}</Text>
            </View>
            <TouchableOpacity onPress={() => setActive(null)} style={{ padding: 4 }}>
              <Text style={{ color: C.muted, fontSize: 16, fontWeight: 'bold' }}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', marginVertical: 10 }}>
            {specTags(active).map((t) => <Text key={t} style={cs.spec}>{t}</Text>)}
          </View>
          <View style={[cs.rowBetween, cs.opRow]}>
            <Text style={cs.muted}>👨‍🔧 {active.ownerName}</Text>
            <Text style={{ color: isFree(active) ? C.green : C.red, fontSize: 12, fontWeight: 'bold' }}>● {statusLabel(active)}</Text>
          </View>
          <View style={[cs.rowBetween, { marginTop: 8 }]}>
            <Text style={cs.price}>{formatMoney(active.priceHour)}<Text style={{ fontSize: 12, color: C.muted }}> / час</Text></Text>
            <TouchableOpacity style={[cs.btn, !isFree(active) && cs.btnDisabled]} disabled={!isFree(active)} onPress={() => onBook(active)}>
              <Text style={cs.btnText}>{isFree(active) ? 'Забронировать' : 'Недоступна'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

/* ===================== БРОНИРОВАНИЕ ===================== */
const DAY_NAMES = ['Сегодня', 'Завтра', 'Послезавтра'];
const TIMES = ['08:00', '10:00', '12:00', '14:00', '16:00'];
const pad = (n: number) => String(n).padStart(2, '0');

function BookingScreen({
  item, user, onBack, onDone,
}: { item: Equipment; user: LatLng; onBack: () => void; onDone: (order: Order) => void }) {
  const days = DAY_NAMES.map((name, n) => {
    const d = new Date(Date.now() + n * 864e5);
    return `${name}, ${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
  });

  const [dayIdx, setDayIdx] = useState(0);
  const [time, setTime] = useState(TIMES[0]);
  const [hours, setHours] = useState(Math.max(item.minimumHours, 4));
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('+7 ');
  const [comment, setComment] = useState('');

  const { km, fee } = estimateDelivery(item, user);
  const work = item.priceHour * hours;
  const total = work + fee;

  const submit = () => {
    if (address.trim().length < 5) return Alert.alert('Укажите адрес объекта');
    if (phone.replace(/\D/g, '').length < 10) return Alert.alert('Укажите телефон', 'Не менее 10 цифр');

    onDone({
      number: 'SK-' + Math.floor(1000 + Math.random() * 9000),
      item,
      startLabel: `${days[dayIdx]}, ${time}`,
      hours,
      address: address.trim(),
      phone: phone.trim(),
      totalPrice: total,
    });
  };

  return (
    <SafeAreaView style={cs.container}>
      <View style={cs.header}>
        <TouchableOpacity onPress={onBack} style={{ width: 70 }}><Text style={{ color: C.accent, fontSize: 15 }}>← Назад</Text></TouchableOpacity>
        <Text style={cs.headerTitle}>Бронирование</Text>
        <View style={{ width: 70 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
          <View style={cs.box}>
            <Text style={cs.cardTitle}>{item.title}</Text>
            <Text style={cs.muted}>{item.categoryName} · {item.district}</Text>
            <Text style={[cs.muted, { marginTop: 4 }]}>Владелец: <Text style={{ color: C.text }}>{item.ownerName}</Text></Text>
          </View>

          <Text style={cs.label}>Дата</Text>
          <View style={cs.wrap}>{days.map((d, i) => <Chip key={d} label={d} active={dayIdx === i} onPress={() => setDayIdx(i)} />)}</View>

          <Text style={cs.label}>Время подачи</Text>
          <View style={cs.wrap}>{TIMES.map((t) => <Chip key={t} label={t} active={time === t} onPress={() => setTime(t)} />)}</View>

          <Text style={cs.label}>Длительность (минимум {item.minimumHours} ч)</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity style={cs.stepBtn} onPress={() => setHours(Math.max(item.minimumHours, hours - 1))}><Text style={cs.stepText}>−</Text></TouchableOpacity>
            <Text style={cs.stepValue}>{hours} ч</Text>
            <TouchableOpacity style={cs.stepBtn} onPress={() => setHours(Math.min(12, hours + 1))}><Text style={cs.stepText}>+</Text></TouchableOpacity>
          </View>

          <Text style={cs.label}>Адрес объекта</Text>
          <TextInput style={cs.input} value={address} onChangeText={setAddress} placeholder="Город, улица, дом" placeholderTextColor="#666" />

          <Text style={cs.label}>Телефон</Text>
          <TextInput style={cs.input} value={phone} onChangeText={setPhone} placeholder="+7 900 000-00-00" placeholderTextColor="#666" keyboardType="phone-pad" />

          <Text style={cs.label}>Комментарий</Text>
          <TextInput style={[cs.input, { height: 80, textAlignVertical: 'top' }]} value={comment} onChangeText={setComment} placeholder="Например: заезд со стороны двора" placeholderTextColor="#666" multiline />

          <View style={[cs.box, { marginTop: 16 }]}>
            <View style={cs.rowBetween}><Text style={cs.muted}>Работа: {formatMoney(item.priceHour)} × {hours} ч</Text><Text style={cs.val}>{formatMoney(work)}</Text></View>
            <View style={[cs.rowBetween, { marginTop: 6 }]}><Text style={cs.muted}>Подача: {km.toFixed(1)} км</Text><Text style={cs.val}>{formatMoney(fee)}</Text></View>
          </View>
        </ScrollView>

        <View style={cs.footer}>
          <View><Text style={cs.muted}>Итого</Text><Text style={cs.price}>{formatMoney(total)}</Text></View>
          <TouchableOpacity style={cs.btn} onPress={submit}><Text style={cs.btnText}>Подтвердить</Text></TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ===================== УСПЕХ ===================== */
function SuccessScreen({ order, onClose }: { order: Order; onClose: () => void }) {
  return (
    <SafeAreaView style={[cs.container, { justifyContent: 'center', padding: 24 }]}>
      <Text style={{ fontSize: 56, textAlign: 'center' }}>✅</Text>
      <Text style={[cs.headerTitle, { textAlign: 'center', marginTop: 12 }]}>Заявка отправлена</Text>
      <Text style={[cs.muted, { textAlign: 'center', marginTop: 4 }]}>Номер: {order.number}</Text>
      <View style={[cs.box, { marginTop: 24 }]}>
        <Text style={{ color: C.text, fontSize: 18, fontWeight: 'bold' }}>{order.item.title}</Text>
        <Text style={[cs.muted, { marginTop: 6 }]}>{order.startLabel} · {order.hours} ч</Text>
        <Text style={cs.muted}>Адрес: {order.address}</Text>
        <Text style={cs.muted}>Телефон: {order.phone}</Text>
        <Text style={[cs.price, { marginTop: 8 }]}>{formatMoney(order.totalPrice)}</Text>
      </View>
      <Text style={[cs.muted, { textAlign: 'center', marginTop: 12 }]}>{order.item.ownerName} свяжется с вами для подтверждения</Text>
      <TouchableOpacity style={[cs.btn, { marginTop: 24 }]} onPress={onClose}><Text style={cs.btnText}>Вернуться к технике</Text></TouchableOpacity>
    </SafeAreaView>
  );
}

/* ===================== КОРЕНЬ ===================== */
type Screen = 'onboarding' | 'role' | 'home' | 'booking' | 'success';

export default function App() {
  const [screen, setScreen] = useState<Screen>('onboarding');
  const [equipment, setEquipment] = useState<Equipment[]>(EQUIPMENT);
  const [selected, setSelected] = useState<Equipment | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [loc, refreshLoc] = useUserLocation(screen !== 'onboarding' && screen !== 'role');

  let content: React.ReactElement;

  if (screen === 'onboarding') {
    content = <OnboardingScreen onStart={() => setScreen('role')} />;
  } else if (screen === 'role') {
    content = <RoleScreen onPick={() => setScreen('home')} />;
  } else if (screen === 'booking' && selected) {
    content = (
      <BookingScreen
        item={selected}
        user={loc.coords}
        onBack={() => setScreen('home')}
        onDone={(o) => {
          setOrder(o);
          setEquipment((list) => list.map((e) => (e.id === o.item.id ? { ...e, status: 'RESERVED' } : e)));
          setScreen('success');
        }}
      />
    );
  } else if (screen === 'success' && order) {
    content = <SuccessScreen order={order} onClose={() => setScreen('home')} />;
  } else {
    content = (
      <HomeScreen
        equipment={equipment}
        loc={loc}
        refreshLoc={refreshLoc}
        onBook={(e) => { setSelected(e); setScreen('booking'); }}
      />
    );
  }

  return (<><StatusBar style="light" />{content}</>);
}

/* ===================== СТИЛИ ===================== */
const cs = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#222' },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: C.text },
  brand: { fontSize: 18, fontWeight: 'bold', color: C.text },
  muted: { color: C.muted, fontSize: 13 },
  note: { color: C.accent, fontSize: 11, paddingHorizontal: 16, paddingVertical: 6, backgroundColor: '#1a1608' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 5 },
  chip: { backgroundColor: C.card, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginRight: 8, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { color: C.soft, fontSize: 13, fontWeight: '500' },
  chipTextActive: { color: '#000', fontWeight: 'bold' },
  btn: { backgroundColor: C.accent, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  btnDisabled: { backgroundColor: '#444' },
  btnText: { color: '#000', fontWeight: 'bold', fontSize: 15 },
  price: { color: C.accent, fontSize: 20, fontWeight: 'bold' },
  spec: { color: C.soft, backgroundColor: C.card2, fontSize: 11, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginRight: 6, overflow: 'hidden' },
  input: { backgroundColor: C.card, color: C.text, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  box: { backgroundColor: C.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border },
  logo: { fontSize: 48, fontWeight: '900', color: C.text },
  subtitle: { fontSize: 17, color: C.muted, marginTop: 12, marginBottom: 40 },
  roleTitle0: { fontSize: 30, fontWeight: '800', color: C.text, marginTop: 30, marginBottom: 4 },
  roleCard: { backgroundColor: C.card, borderRadius: 16, padding: 20, marginTop: 14, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.border },
  roleCardTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  switcher: { backgroundColor: '#222', padding: 4, borderRadius: 12, flexDirection: 'row', marginBottom: 8 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  tabActive: { backgroundColor: C.accent },
  tabText: { color: C.muted, fontSize: 14 },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 12, marginBottom: 12, flexDirection: 'row', borderWidth: 1, borderColor: C.border },
  machine: { width: 96, height: 110, borderRadius: 12, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  cardTitle: { fontSize: 18, fontWeight: 'bold', color: C.text },
  locBtn: { position: 'absolute', top: 12, right: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  bottomCard: { position: 'absolute', bottom: 20, left: 16, right: 16, backgroundColor: C.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border },
  opRow: { borderTopWidth: 1, borderTopColor: C.card2, paddingTop: 8 },
  label: { color: '#aaa', fontSize: 12, marginTop: 14, marginBottom: 8, fontWeight: '600' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  stepBtn: { width: 44, height: 44, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  stepText: { color: C.accent, fontSize: 24, fontWeight: 'bold' },
  stepValue: { color: C.text, fontSize: 18, fontWeight: 'bold', minWidth: 70, textAlign: 'center' },
  val: { color: C.text, fontSize: 14, fontWeight: '600' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderTopWidth: 1, borderTopColor: '#222', backgroundColor: C.bg },
  pill: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 14, borderWidth: 1.5, borderColor: C.accent },
  pillSel: { backgroundColor: C.accent, borderColor: '#fff' },
  pillBusy: { borderColor: C.red },
  pillText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  userPin: { backgroundColor: C.accent, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  userPinText: { color: '#000', fontSize: 11, fontWeight: 'bold' },
});
