import StaffAttendance from '../model/staffAttendanceModel.js';
import Admin from '../model/adminModel.js';
import { createPaginationMetadata, parsePagination } from '../utils/pagination.js';

const LAGOS_TIME_ZONE = 'Africa/Lagos';
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isValidDateKey = (value) => {
  if (!DAY_PATTERN.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
};

const getLagosDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LAGOS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const getDateKeys = (from, to) => {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const days = Math.floor((end.getTime() - start.getTime()) / 86400000);
  if (days < 0 || days > 89) return null;
  return Array.from({ length: days + 1 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
};

const materializeAbsences = async (staffIds, dateKeys, today) => {
  const completedDays = dateKeys.filter((date) => date < today);
  const insertOperations = staffIds.flatMap((staff) => completedDays.map((attendanceDate) => ({
    updateOne: {
      filter: { staff, attendanceDate },
      update: { $setOnInsert: { staff, attendanceDate, status: 'absent' } },
      upsert: true,
    },
  })));
  if (!insertOperations.length) return;
  await StaffAttendance.bulkWrite(insertOperations, { ordered: false });
  const expiredNotClockedInOperations = staffIds.flatMap((staff) => completedDays.map((attendanceDate) => ({
    updateOne: {
      filter: { staff, attendanceDate, status: 'not_clocked_in' },
      update: { $set: { status: 'absent' } },
    },
  })));
  await StaffAttendance.bulkWrite(expiredNotClockedInOperations, { ordered: false });
};

const materializeNotClockedIn = async (staffIds, today) => {
  if (!staffIds.length) return;
  await StaffAttendance.bulkWrite(staffIds.map((staff) => ({
    updateOne: {
      filter: { staff, attendanceDate: today },
      update: { $setOnInsert: { staff, attendanceDate: today, status: 'not_clocked_in' } },
      upsert: true,
    },
  })), { ordered: false });
};

const requireStaff = (req, res) => {
  if (req.admin?.role !== 'staff') {
    res.status(403).json({ success: false, message: 'Attendance clock-in is available to staff accounts only.' });
    return false;
  }
  return true;
};

export const clockInStaff = async (req, res) => {
  if (!requireStaff(req, res)) return;
  const attendanceDate = getLagosDateKey();
  const clockIn = new Date();
  try {
    const existing = await StaffAttendance.findOne({ staff: req.admin._id, attendanceDate });
    if (existing && !['absent', 'not_clocked_in'].includes(existing.status)) {
      return res.status(409).json({ success: false, message: 'You have already clocked in for today.', data: existing });
    }
    const attendance = existing
      ? await StaffAttendance.findOneAndUpdate(
        { _id: existing._id, status: { $in: ['absent', 'not_clocked_in'] } },
        { $set: { status: 'present', clockIn, clockOut: null, durationMinutes: 0 } },
        { new: true, runValidators: true },
      )
      : await StaffAttendance.create({ staff: req.admin._id, attendanceDate, status: 'present', clockIn });
    if (!attendance) {
      return res.status(409).json({ success: false, message: 'Your attendance state changed; refresh and try again.' });
    }
    return res.status(201).json({ success: true, data: attendance });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'You have already clocked in for today.' });
    }
    console.error('Staff clock-in error:', error);
    return res.status(500).json({ success: false, message: 'Could not record your clock-in.' });
  }
};

export const clockOutStaff = async (req, res) => {
  if (!requireStaff(req, res)) return;
  const attendanceDate = getLagosDateKey();
  const clockOut = new Date();
  try {
    const attendance = await StaffAttendance.findOne({ staff: req.admin._id, attendanceDate, status: 'present' });
    if (!attendance || !attendance.clockIn) {
      return res.status(409).json({ success: false, message: 'Clock in before ending your workday.' });
    }
    const durationMinutes = Math.max(0, Math.floor((clockOut.getTime() - attendance.clockIn.getTime()) / 60000));
    const completed = await StaffAttendance.findOneAndUpdate(
      { _id: attendance._id, status: 'present', clockOut: null },
      { $set: { clockOut, durationMinutes, status: 'completed' } },
      { new: true, runValidators: true },
    );
    if (!completed) {
      return res.status(409).json({ success: false, message: 'Your attendance was already clocked out. Refresh to see the recorded time.' });
    }
    return res.json({ success: true, data: completed });
  } catch (error) {
    console.error('Staff clock-out error:', error);
    return res.status(500).json({ success: false, message: 'Could not record your clock-out.' });
  }
};

export const getMyStaffAttendance = async (req, res) => {
  if (!requireStaff(req, res)) return;
  const today = getLagosDateKey();
  const from = req.query.from || getLagosDateKey(new Date(Date.now() - 29 * 86400000));
  const range = getDateKeys(from, today);
  if (!isValidDateKey(from) || from > today || !range) {
    return res.status(400).json({ success: false, message: 'Choose a valid attendance period of no more than 90 days.' });
  }
  try {
    await materializeAbsences([req.admin._id], range, today);
    await materializeNotClockedIn([req.admin._id], today);
    const [todayRecord, history] = await Promise.all([
      StaffAttendance.findOne({ staff: req.admin._id, attendanceDate: today }).lean(),
      StaffAttendance.find({ staff: req.admin._id, attendanceDate: { $gte: range[0], $lte: today } })
        .sort({ attendanceDate: -1 }).lean(),
    ]);
    return res.json({ success: true, data: { today: todayRecord, history, todayDate: today } });
  } catch (error) {
    console.error('Get staff attendance error:', error);
    return res.status(500).json({ success: false, message: 'Could not load your attendance history.' });
  }
};

export const listStaffAttendance = async (req, res) => {
  const today = getLagosDateKey();
  const from = req.query.from || getLagosDateKey(new Date(Date.now() - 29 * 86400000));
  const to = req.query.to || today;
  if (!isValidDateKey(from) || !isValidDateKey(to) || to > today) {
    return res.status(400).json({ success: false, message: 'Use YYYY-MM-DD for attendance date filters.' });
  }
  const dateKeys = getDateKeys(from, to);
  if (!dateKeys) {
    return res.status(400).json({ success: false, message: 'Choose an attendance period of no more than 90 days.' });
  }
  try {
    const activeStaff = await Admin.find({ role: 'staff', isActive: true }).select('_id name email department').lean();
    await materializeAbsences(activeStaff.map((staff) => staff._id), dateKeys, today);
    if (to >= today) await materializeNotClockedIn(activeStaff.map((staff) => staff._id), today);
    const { page, limit, skip } = parsePagination(req.query, 100, 200);
    const filter = { attendanceDate: { $gte: from, $lte: to } };
    const [records, totalItems, todayRecords, absentCount] = await Promise.all([
      StaffAttendance.find(filter).populate('staff', 'name email department')
        .sort({ attendanceDate: -1, clockIn: -1 }).skip(skip).limit(limit).lean(),
      StaffAttendance.countDocuments(filter),
      StaffAttendance.find({ attendanceDate: today }).select('staff status').lean(),
      StaffAttendance.countDocuments({ ...filter, status: 'absent' }),
    ]);
    const stats = {
      presentToday: todayRecords.filter((record) => ['present', 'completed'].includes(record.status)).length,
      absent: absentCount,
      notClockedIn: todayRecords.filter((record) => record.status === 'not_clocked_in').length,
    };
    return res.json({
      success: true,
      data: records,
      stats,
      pagination: createPaginationMetadata(totalItems, page, limit),
    });
  } catch (error) {
    console.error('List staff attendance error:', error);
    return res.status(500).json({ success: false, message: 'Could not load staff attendance.' });
  }
};
