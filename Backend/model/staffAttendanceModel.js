import mongoose from 'mongoose';

const staffAttendanceSchema = new mongoose.Schema({
  staff: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true, index: true },
  attendanceDate: { type: String, required: true },
  status: { type: String, enum: ['not_clocked_in', 'present', 'completed', 'absent'], required: true, default: 'not_clocked_in' },
  clockIn: { type: Date, default: null },
  clockOut: { type: Date, default: null },
  durationMinutes: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

staffAttendanceSchema.index({ staff: 1, attendanceDate: 1 }, { unique: true });
staffAttendanceSchema.index({ attendanceDate: -1, status: 1 });

export default mongoose.model('StaffAttendance', staffAttendanceSchema);
