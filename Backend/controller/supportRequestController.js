import mongoose from 'mongoose';
import SupportRequest from '../model/supportRequestModel.js';
import AdminTask from '../model/adminTaskModel.js';
import { createPaginationMetadata, parsePagination } from '../utils/pagination.js';

const cleanMessage = (value) => typeof value === 'string' ? value.trim().slice(0, 4000) : '';

export const createSupportRequest = async (req, res) => {
  const subject = typeof req.body.subject === 'string' ? req.body.subject.trim().slice(0, 120) : '';
  const description = cleanMessage(req.body.description);
  if (subject.length < 4 || description.length < 10) {
    return res.status(400).json({ success: false, message: 'Enter a subject and describe the issue in at least 10 characters.' });
  }
  try {
    const request = await SupportRequest.create({ user: req.authUserId, subject, description });
    return res.status(201).json({ success: true, data: request });
  } catch (error) {
    console.error('Create support request error:', error);
    return res.status(500).json({ success: false, message: 'Could not submit your support request.' });
  }
};

export const listMySupportRequests = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query, 20, 50);
    const [requests, totalItems] = await Promise.all([
      SupportRequest.find({ user: req.authUserId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      SupportRequest.countDocuments({ user: req.authUserId }),
    ]);
    return res.json({ success: true, data: requests, pagination: createPaginationMetadata(totalItems, page, limit) });
  } catch (error) {
    console.error('List user support requests error:', error);
    return res.status(500).json({ success: false, message: 'Could not load your support requests.' });
  }
};

export const addSupportRequestReply = async (req, res) => {
  const message = cleanMessage(req.body.message);
  if (message.length < 2) return res.status(400).json({ success: false, message: 'Enter a reply before sending.' });
  try {
    const request = await SupportRequest.findOne({ _id: req.params.id, user: req.authUserId });
    if (!request) return res.status(404).json({ success: false, message: 'Support request not found.' });
    if (request.status === 'resolved') {
      request.status = 'open';
      request.assignedTo = null;
      request.assignedBy = null;
    }
    request.messages.push({ senderRole: 'user', senderId: req.authUserId, message });
    await request.save();
    return res.json({ success: true, data: request });
  } catch (error) {
    console.error('Reply to support request error:', error);
    return res.status(500).json({ success: false, message: 'Could not send your reply.' });
  }
};

export const listAdminSupportRequests = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query, 100, 200);
    const filter = {};
    if (['open', 'assigned', 'in_progress', 'resolved'].includes(req.query.status)) filter.status = req.query.status;
    const [requests, totalItems] = await Promise.all([
      SupportRequest.find(filter).populate('user', 'name email').populate('assignedTo', 'name email')
        .sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      SupportRequest.countDocuments(filter),
    ]);
    return res.json({ success: true, data: requests, pagination: createPaginationMetadata(totalItems, page, limit) });
  } catch (error) {
    console.error('List admin support requests error:', error);
    return res.status(500).json({ success: false, message: 'Could not load user support requests.' });
  }
};

export const updateAdminSupportRequest = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid support request ID.' });
  }
  const message = req.body.message === undefined ? '' : cleanMessage(req.body.message);
  const allowedStatuses = req.admin.role === 'staff'
    ? ['in_progress', 'resolved']
    : ['open', 'assigned', 'in_progress', 'resolved'];
  const status = req.body.status;
  if (status !== undefined && !allowedStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: 'Select a valid support request status.' });
  }
  if (req.body.message !== undefined && message.length < 2) {
    return res.status(400).json({ success: false, message: 'Enter a reply before sending.' });
  }
  try {
    if (req.admin.role === 'staff') {
      const assignment = await AdminTask.exists({
        assignedTo: req.admin._id,
        relatedSupportRequest: req.params.id,
        status: { $in: ['todo', 'in_progress'] },
      });
      if (!assignment) return res.status(403).json({ success: false, message: 'This request must be assigned to you before you can update it.' });
    }
    const requestFilter = { _id: req.params.id };
    if (req.admin.role === 'staff') requestFilter.assignedTo = req.admin._id;
    const request = await SupportRequest.findOne(requestFilter);
    if (!request) return res.status(404).json({ success: false, message: 'Support request not found.' });
    if (req.body.message !== undefined) {
      request.messages.push({
        senderRole: req.admin.role === 'staff' ? 'staff' : 'admin',
        senderId: req.admin._id,
        message,
      });
    }
    if (status) request.status = status;
    else if (req.admin.role === 'staff' && request.status === 'assigned') request.status = 'in_progress';
    await request.save();
    return res.json({ success: true, data: request });
  } catch (error) {
    console.error('Update support request error:', error);
    return res.status(500).json({ success: false, message: 'Could not update this support request.' });
  }
};
